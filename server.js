const express = require("express");

const app = express();

const PORT = process.env.PORT || 7000;
const PMDB_API_KEY = process.env.PMDB_API_KEY;

const PMDB_BASE = "https://publicmetadb.com";

// ----------------------------------------------------
// Manifest
// ----------------------------------------------------

app.get("/manifest.json", (req, res) => {
    res.json({
        id: "com.pmdb.nuvio.continuewatching",
        version: "1.0.1",
        name: "PMDB Continue Watching",
        description: "Continue Watching from PublicMetaDB",

        resources: [
            "catalog",
            "meta"
        ],

        types: [
            "movie",
            "series"
        ],

        catalogs: [
            {
                type: "movie",
                id: "pmdb-continue-movies",
                name: "PMDB Continue Watching"
            },
            {
                type: "series",
                id: "pmdb-continue-series",
                name: "PMDB Continue Watching"
            }
        ]
    });
});

// ----------------------------------------------------
// Get PMDB resume data
// ----------------------------------------------------

async function getPMDBResume() {

    if (!PMDB_API_KEY) {
        throw new Error("PMDB_API_KEY is missing");
    }

    const url =
        `${PMDB_BASE}/api/external/resume?page=1&perPage=100`;

    console.log("Requesting PMDB:", url);

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${PMDB_API_KEY}`,
            "Accept": "application/json"
        }
    });

    const text = await response.text();

    console.log("PMDB HTTP status:", response.status);

    if (!response.ok) {
        console.error("PMDB error:", text.substring(0, 1000));

        throw new Error(
            `PMDB returned HTTP ${response.status}`
        );
    }

    let data;

    try {
        data = JSON.parse(text);
    } catch (error) {
        console.error("PMDB did not return JSON");
        console.error(text.substring(0, 1000));

        throw new Error("PMDB returned invalid JSON");
    }

    return data;
}

// ----------------------------------------------------
// Extract rows
// ----------------------------------------------------

function getRows(data) {

    if (Array.isArray(data)) {
        return data;
    }

    if (!data || typeof data !== "object") {
        return [];
    }

    for (const key of ["items", "results", "data"]) {

        if (Array.isArray(data[key])) {
            return data[key];
        }
    }

    return [];
}

// ----------------------------------------------------
// Safe diagnostic information
// Does NOT expose your actual watch history.
// ----------------------------------------------------

app.get("/debug/pmdb", async (req, res) => {

    try {

        const data = await getPMDBResume();
        const rows = getRows(data);

        const first =
            rows.length > 0 &&
            rows[0] &&
            typeof rows[0] === "object"
                ? rows[0]
                : null;

        const firstRowKeys =
            first
                ? Object.keys(first)
                : [];

        const topLevelKeys =
            data &&
            typeof data === "object" &&
            !Array.isArray(data)
                ? Object.keys(data)
                : [];

        res.json({
            success: true,

            pmdbResponseType:
                Array.isArray(data)
                    ? "array"
                    : typeof data,

            topLevelKeys,

            rowCount: rows.length,

            firstRowKeys,

            detectedFields: {
                mediaType: first
                    ? (
                        first.media_type ??
                        first.mediaType ??
                        first.type ??
                        null
                    )
                    : null,

                tmdb: first
                    ? (
                        first.tmdb_id ??
                        first.tmdbId ??
                        first.tmdb ??
                        first.ids?.tmdb ??
                        first.show_ids?.tmdb ??
                        null
                    )
                    : null,

                season: first
                    ? (
                        first.season ??
                        first.season_number ??
                        first.seasonNumber ??
                        null
                    )
                    : null,

                episode: first
                    ? (
                        first.episode ??
                        first.episode_number ??
                        first.episodeNumber ??
                        null
                    )
                    : null,

                progress: first
                    ? (
                        first.progress_ms ??
                        first.progressMs ??
                        first.position_ms ??
                        first.positionMs ??
                        first.viewOffset ??
                        first.progress_percent ??
                        first.progressPercent ??
                        first.percent ??
                        first.progress ??
                        null
                    )
                    : null,

                duration: first
                    ? (
                        first.duration_ms ??
                        first.durationMs ??
                        first.runtime_ms ??
                        first.runtimeMs ??
                        first.duration ??
                        first.runtime ??
                        null
                    )
                    : null
            }
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ----------------------------------------------------
// Convert PMDB item
// ----------------------------------------------------

function convertItem(item) {

    if (!item || typeof item !== "object") {
        return null;
    }

    const mediaType =
        item.media_type ??
        item.mediaType ??
        item.type ??
        "";

    const normalizedType =
        String(mediaType).toLowerCase();

    // PMDB can store TMDB IDs in different structures.
    const tmdb =
        item.ids?.tmdb ??
        item.show_ids?.tmdb ??
        item.tmdb ??
        item.tmdb_id ??
        item.tmdbId;

    if (!tmdb) {
        return null;
    }

    // ------------------------------------------------
    // TV
    // ------------------------------------------------

    if (
        normalizedType === "tv" ||
        normalizedType === "show" ||
        normalizedType === "series" ||
        normalizedType === "episode"
    ) {

        const season =
            item.season ??
            item.season_number ??
            item.seasonNumber;

        const episode =
            item.episode ??
            item.episode_number ??
            item.episodeNumber;

        if (
            season === undefined ||
            episode === undefined
        ) {
            return null;
        }

        const title =
            item.series_title ??
            item.show_title ??
            item.name ??
            item.title ??
            "Unknown";

        return {
            id: `tmdb:${tmdb}`,
            type: "series",
            name: title,

            // Keep this information for later.
            season: Number(season),
            episode: Number(episode),

            behaviorHints: {
                defaultVideoId:
                    `${Number(season)}:${Number(episode)}`
            }
        };
    }

    // ------------------------------------------------
    // MOVIE
    // ------------------------------------------------

    return {
        id: `tmdb:${tmdb}`,
        type: "movie",
        name:
            item.title ??
            item.name ??
            "Unknown"
    };
}

// ----------------------------------------------------
// Get usable Continue Watching items
// ----------------------------------------------------

async function getContinueWatching() {

    const data = await getPMDBResume();

    const rows = getRows(data);

    console.log("PMDB rows received:", rows.length);

    const converted = [];

    for (const row of rows) {

        const item = convertItem(row);

        if (item) {
            converted.push(item);
        }
    }

    console.log(
        "PMDB items converted:",
        converted.length
    );

    return converted;
}

// ----------------------------------------------------
// Movie catalog
// ----------------------------------------------------

app.get(
    "/catalog/movie/pmdb-continue-movies.json",
    async (req, res) => {

        try {

            const items =
                await getContinueWatching();

            const movies =
                items.filter(
                    item => item.type === "movie"
                );

            res.json({
                metas: movies
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                metas: []
            });
        }
    }
);

// ----------------------------------------------------
// Series catalog
// ----------------------------------------------------

app.get(
    "/catalog/series/pmdb-continue-series.json",
    async (req, res) => {

        try {

            const items =
                await getContinueWatching();

            const series =
                items.filter(
                    item => item.type === "series"
                );

            res.json({
                metas: series
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                metas: []
            });
        }
    }
);

// ----------------------------------------------------
// Health check
// ----------------------------------------------------

app.get("/", (req, res) => {

    res.send(
        "PMDB Continue Watching addon is running."
    );

});

// ----------------------------------------------------
// Start
// ----------------------------------------------------

app.listen(PORT, () => {

    console.log(
        `PMDB Nuvio addon running on port ${PORT}`
    );

});
