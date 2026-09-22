/* --------------------------------------------------------------------------
 * Racquetback - Profile-aware local storage layer
 *
 * All match, bracket and ranking data lives in the browser's localStorage,
 * namespaced per profile so several people can share one device.
 *
 *   cs_profiles              -> [{ id, name, createdAt }]
 *   cs_activeProfile         -> profile id
 *   cs:<profileId>:<key>     -> that profile's data
 *
 * Every access is wrapped: localStorage throws in private mode and in some
 * embedded webviews, and the app must still run (in memory) when it does.
 * ------------------------------------------------------------------------ */

window.Store = (function () {
    const PROFILES_KEY = 'cs_profiles';
    const ACTIVE_KEY = 'cs_activeProfile';
    const MIGRATED_FLAG = 'cs_migratedToProfiles';
    const LEGACY_KEYS = { tournament: 'cs_tournament', leaderboard: 'cs_leaderboard' };

    // In-memory fallback so the app degrades instead of crashing.
    let memory = {};
    let storageWorks = true;

    function raw(key) {
        try { return localStorage.getItem(key); }
        catch (e) { storageWorks = false; return key in memory ? memory[key] : null; }
    }

    function setRaw(key, value) {
        memory[key] = value;
        try { localStorage.setItem(key, value); return true; }
        catch (e) { storageWorks = false; return false; }
    }

    function removeRaw(key) {
        delete memory[key];
        try { localStorage.removeItem(key); } catch (e) { storageWorks = false; }
    }

    function readJSON(key, fallback) {
        const value = raw(key);
        if (value === null) return fallback;
        try { return JSON.parse(value); }
        catch (e) { return fallback; }
    }

    function writeJSON(key, value) {
        return setRaw(key, JSON.stringify(value));
    }

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // --------- PROFILES ---------

    function listProfiles() {
        const list = readJSON(PROFILES_KEY, []);
        return Array.isArray(list) ? list : [];
    }

    function writeProfiles(list) {
        writeJSON(PROFILES_KEY, list);
    }

    function activeId() {
        const id = raw(ACTIVE_KEY);
        const list = listProfiles();
        if (id && list.some(p => p.id === id)) return id;
        return list.length ? list[0].id : null;
    }

    function activeProfile() {
        const id = activeId();
        return listProfiles().find(p => p.id === id) || null;
    }

    // Names are only labels, but a duplicate is confusing on a shared device.
    function uniqueName(name, list) {
        const taken = new Set(list.map(p => p.name.toLowerCase()));
        if (!taken.has(name.toLowerCase())) return name;
        let n = 2;
        while (taken.has((name + ' ' + n).toLowerCase())) n++;
        return name + ' ' + n;
    }

    function createProfile(name, makeActive) {
        const list = listProfiles();
        const profile = {
            id: newId(),
            name: uniqueName((name || 'New Profile').trim().slice(0, 24) || 'New Profile', list),
            createdAt: new Date().toISOString()
        };
        list.push(profile);
        writeProfiles(list);
        if (makeActive !== false) setRaw(ACTIVE_KEY, profile.id);
        return profile;
    }

    function renameProfile(id, name) {
        const list = listProfiles();
        const profile = list.find(p => p.id === id);
        if (!profile) return null;
        const others = list.filter(p => p.id !== id);
        profile.name = uniqueName((name || '').trim().slice(0, 24) || profile.name, others);
        writeProfiles(list);
        return profile;
    }

    function switchProfile(id) {
        if (!listProfiles().some(p => p.id === id)) return false;
        setRaw(ACTIVE_KEY, id);
        return true;
    }

    // Deleting a profile removes its data too. The last profile cannot be
    // deleted, so the app always has somewhere to write.
    function deleteProfile(id) {
        const list = listProfiles();
        if (list.length <= 1) return false;
        const remaining = list.filter(p => p.id !== id);
        if (remaining.length === list.length) return false;

        Object.keys(LEGACY_KEYS).forEach(key => removeRaw('cs:' + id + ':' + key));
        writeProfiles(remaining);
        if (activeId() === id || raw(ACTIVE_KEY) === id) setRaw(ACTIVE_KEY, remaining[0].id);
        return true;
    }

    // --------- NAMESPACED DATA ---------

    function scopedKey(key) {
        const id = activeId();
        return id ? 'cs:' + id + ':' + key : 'cs:orphan:' + key;
    }

    function load(key, fallback) {
        return readJSON(scopedKey(key), fallback);
    }

    function save(key, value) {
        return writeJSON(scopedKey(key), value);
    }

    function clear(key) {
        removeRaw(scopedKey(key));
    }

    function profileData(id) {
        const data = {};
        Object.keys(LEGACY_KEYS).forEach(key => {
            data[key] = readJSON('cs:' + id + ':' + key, null);
        });
        return data;
    }

    // --------- MIGRATION ---------
    // Existing installs kept everything in flat cs_tournament / cs_leaderboard
    // keys. Copy those into a first profile once. The legacy keys are left in
    // place untouched, so rolling the app back loses nothing.

    function migrate() {
        if (raw(MIGRATED_FLAG) === 'true' && listProfiles().length) return;

        let list = listProfiles();
        if (!list.length) {
            const first = createProfile('My Tracker');
            list = [first];

            Object.keys(LEGACY_KEYS).forEach(key => {
                const legacy = raw(LEGACY_KEYS[key]);
                if (legacy !== null) setRaw('cs:' + first.id + ':' + key, legacy);
            });
        }
        setRaw(MIGRATED_FLAG, 'true');
    }

    // --------- BACKUP ---------

    function exportAll() {
        return {
            app: 'racquetback',
            version: 1,
            exportedAt: new Date().toISOString(),
            profiles: listProfiles().map(p => ({
                name: p.name,
                createdAt: p.createdAt,
                data: profileData(p.id)
            }))
        };
    }

    function exportFilename() {
        return 'racquetback-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    }

    // Imports are additive: restored profiles are added alongside whatever is
    // already here, so importing can never overwrite live data.
    function importAll(payload) {
        if (!payload || payload.app !== 'racquetback' || !Array.isArray(payload.profiles)) {
            throw new Error('Not a Racquetback backup file.');
        }

        let added = 0;
        payload.profiles.forEach(entry => {
            if (!entry || typeof entry.name !== 'string') return;
            const profile = createProfile(entry.name, false);
            const data = entry.data || {};
            Object.keys(LEGACY_KEYS).forEach(key => {
                if (data[key] !== undefined && data[key] !== null) {
                    writeJSON('cs:' + profile.id + ':' + key, data[key]);
                }
            });
            added++;
        });

        if (!added) throw new Error('That backup contained no profiles.');
        return added;
    }

    // --------- EVICTION RESISTANCE ---------
    // Safari clears script-writable storage after 7 days of no visits. Asking
    // for persistent storage (and installing to the home screen) exempts it.

    function requestPersistence() {
        if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(null);
        return navigator.storage.persisted()
            .then(already => already ? true : navigator.storage.persist())
            .catch(() => null);
    }

    return {
        migrate, listProfiles, activeProfile, activeId,
        createProfile, renameProfile, switchProfile, deleteProfile,
        load, save, clear,
        exportAll, exportFilename, importAll,
        requestPersistence,
        isReliable: function () { return storageWorks; }
    };
})();
