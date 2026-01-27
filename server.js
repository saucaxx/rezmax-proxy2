const express = require('express');
const cors = require('cors');
const rezmaxService = require('./rezmaxService'); // Aici importa fisierul de mai sus
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Rute
app.get('/', (req, res) => res.send('JetCab Proxy Active'));

app.get('/api/cities', async (req, res) => {
    try {
        const result = await rezmaxService.getDepartureCities();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/search', async (req, res) => {
    try {
        const { departureCityId, destinationCityId, date } = req.body;
        const result = await rezmaxService.searchBuses(departureCityId, destinationCityId, date);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ACEASTA ESTE SINGURA LINIE CARE PORNESTE SERVERUL
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
