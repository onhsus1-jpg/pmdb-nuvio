const express = require("express");

const app = express();

const PORT = process.env.PORT || 7000;
const PMDB_API_KEY = process.env.PMDB_API_KEY;

const PMDB_BASE = "https://publicmetadb.com";

// ----------------------------------------------------
// Basic configuration
// ----------------------------------------------------

if (!PMDB_API_KEY) {
    console.warn("WARNING: PMDB_API_KEY is not configured.");
}

// ----------------------------------------------------
// Manifest
// ----------------------------------------------------

app.get("/manifest.json", (req, res) => {
    res.json({
        id: "com.pmdb.nuvio.continuewatching",
        version: "1.0.0",
        name: "PMDB Continue Watching",
        description: "Continue Watching from PublicMetaDB",
        logo: "https://publicmetadb.com/favicon.ico",

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
// PMDB API helper
// ----------------------------------------------------

async function getPMDBResume() {

    if (!PMDB_API_KEY) {
        throw new Error("PMDB_API_KEY is missing");
    }

    const url =
        `${PMDB_BASE}/api/external/resume?page=1&perPage=100`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${PMDB_API_KEY}`,
            "Accept": "application/json"
        }
    });

    if (!response.ok) {
        const text = await response.text();

        throw new Error(
            `PMDB returned ${response.status}: ${text}`
        );
    }

    return await response.json();
}

// ----------------------------------------------------
// Convert PMDB item → Stremio item
// ----------------------------------------------------

function convertItem(item) {

    const mediaType =
        item.media_type ||
        item.mediaType ||
        item.type;

    const ids =
        item.show_ids ||
        item.showIds ||
        item.ids ||
        {};

    const tmdb =
        ids.tmdb ||
        item.tmdb_id ||
        item.tmdbId;

    if (!tmdb) {
        return null;
    }

    // TV episode
    if (
        mediaType === "tv" ||
        mediaType === "series" ||
        mediaType === "episode"
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

        return {
            id: `tmdb:${tmdb}:${season}:${episode}`,
            type: "series",
            name: item.title || item.name || "Unknown",
            season: Number(season),
            episode: Number(episode)
        };
    }

    // Movie
    return {
        id: `tmdb:${tmdb}`,
        type: "movie",
        name: item.title || item.name || "Unknown"
    };
}

// ----------------------------------------------------
// Get all PMDB resume items
// ----------------------------------------------------

async function getContinueWatching() {

    const data = await getPMDBResume();

    // PMDB/CrossWatch implementations can return
    // different wrapper structures, so support them.

    let items = [];

    if (Array.isArray(data)) {
        items = data;
    } else if (Array.isArray(data.items)) {
        items = data.items;
    } else if (Array.isArray(data.results)) {
        items = data.results;
    } else if (Array.isArray(data.data)) {
        items = data.data;
    }

    return items
        .map(convertItem)
        .filter(Boolean);
}

// ----------------------------------------------------
// Movie catalog
// ----------------------------------------------------

app.get(
    "/catalog/movie/pmdb-continue-movies.json",
    async (req, res) => {

        try {

            const items = await getContinueWatching();

            const movies = items.filter(
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

            const items = await getContinueWatching();

            const series = items.filter(
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
// Start server
// ----------------------------------------------------

app.listen(PORT, () => {

    console.log(
        `PMDB Nuvio addon running on port ${PORT}`
    );

});
