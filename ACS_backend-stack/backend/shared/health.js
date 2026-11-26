'use strict';

/**
 * Reports API availability only after checking the configured Supabase dependency.
 * `tables` should contain the primary tables required by the calling API module.
 */
async function respondWithDatabaseHealth(res, supabaseAdmin, service, tables = ['profiles']) {
    const checks = {};
    let healthy = true;

    for (const definition of tables) {
        const table = typeof definition === 'string' ? definition : definition.table;
        const columns = typeof definition === 'string' ? '*' : (definition.columns || '*');
        if (!table) continue;
        try {
            const { error } = await supabaseAdmin.from(table).select(columns, { head: true, count: 'exact' }).limit(1);
            if (error) {
                healthy = false;
                checks[table] = 'unavailable';
                console.error(`[HEALTH] ${service}: Supabase check failed for public.${table} (${columns}): ${error.message}`);
            } else {
                checks[table] = 'connected';
            }
        } catch (error) {
            healthy = false;
            checks[table] = 'unavailable';
            console.error(`[HEALTH] ${service}: Supabase check failed for public.${table} (${columns}): ${error.message}`);
        }
    }

    return res.status(healthy ? 200 : 503).json({
        success: healthy,
        service,
        status: healthy ? 'ok' : 'degraded',
        dependencies: { supabase: healthy ? 'connected' : 'unavailable' },
        checks
    });
}

module.exports = { respondWithDatabaseHealth };
