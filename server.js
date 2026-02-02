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

app.post('/api/seats', async (req, res) => {
    try {
        const { optionId, date } = req.body;
        
        console.log(`[API] Cerere locuri pentru OptionID: ${optionId}`);

        // Pasul A: Obtinem LinkId-ul real (Trip Details)
        // RezMax cere LinkId pentru seats, nu OptionId-ul de la Search
        const details = await rezmaxService.getTripDetails(optionId, date);
        
        if (!details.success) {
            return res.json({ success: false, error: "Eroare la obtinerea detaliilor cursei." });
        }

        const realLinkId = details.linkId;
        console.log(`[API] LinkId real identificat: ${realLinkId}`);

        // Pasul B: Obtinem locurile folosind LinkId
        const seatsResult = await rezmaxService.getBusSeats(realLinkId, date);
        
        // Trimitem totul inapoi la Botpress
        res.json({
            success: true,
            linkId: realLinkId, // Il trimitem ca sa il salvam in Botpress pentru Rezervare
            ...seatsResult
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ACEASTA ESTE SINGURA LINIE CARE PORNESTE SERVERUL
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

