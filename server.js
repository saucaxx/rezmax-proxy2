const express = require('express');
const cors = require('cors');
const rezmaxService = require('./rezmaxService'); 
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

        // Pasul A: Obtinem LinkId si verificam DACA se pot alege locuri
        const details = await rezmaxService.getTripDetails(optionId, date);
        
        if (!details.success) {
            return res.json({ success: false, error: "Eroare la obtinerea detaliilor cursei." });
        }

        const realLinkId = details.linkId;
        console.log(`[API] LinkId: ${realLinkId} | Se pot alege locuri? ${details.seatSelect}`);

        // LOGICA NOUA: Daca RezMax zice SeatSelect="0", ne oprim aici.
        if (!details.seatSelect) {
            return res.json({
                success: true,
                linkId: realLinkId,
                autoAllocation: true, // Flag special pentru Botpress
                availableSeats: [],
                message: "Locurile se aloca automat la imbarcare."
            });
        }

        // Pasul B: Daca SeatSelect="1", abia atunci cerem harta
        const seatsResult = await rezmaxService.getBusSeats(realLinkId, date);
        
        res.json({
            success: true,
            linkId: realLinkId,
            autoAllocation: false,
            ...seatsResult
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
