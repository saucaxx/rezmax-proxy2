const express = require('express');
const cors = require('cors');
const rezmaxService = require('./rezmaxService');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// --- RUTE ---

// 1. Test Server
app.get('/', (req, res) => {
    res.send('JetCab RezMax Proxy is running! 🚀');
});

// 2. Get Departure Cities (Orase de plecare)
app.get('/api/cities', async (req, res) => {
    try {
        console.log("[Proxy] Fetching departure cities...");
        const result = await rezmaxService.getDepartureCities();
        res.json(result);
    } catch (error) {
        console.error("[Proxy Error] /api/cities:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Search Buses (Cautare Curse)
app.post('/api/search', async (req, res) => {
    try {
        const { departureCityId, destinationCityId, date, passengers } = req.body;
        
        console.log(`[Proxy] Searching: ${departureCityId} -> ${destinationCityId} on ${date}`);
        
        // Validare simpla
        if (!departureCityId || !destinationCityId || !date) {
            return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        const result = await rezmaxService.searchBuses(departureCityId, destinationCityId, date, passengers || 1);
        res.json(result);

    } catch (error) {
        console.error("[Proxy Error] /api/search:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Pornire Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});