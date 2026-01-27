const axios = require('axios');
const { create } = require('xmlbuilder2');
const { XMLParser } = require('fast-xml-parser');

// Configurare Credentiale din Environment Variables
const CONFIG = {
    URL: process.env.REZMAX_URL || 'https://rezmax.ro/Services/Ticketing.aspx',
    AGENT: process.env.REZMAX_AGENT || 'JetCab',
    ID: process.env.REZMAX_ID,     // A7B21AA1...
    PASS: process.env.REZMAX_PASS  // E50BC2DA...
};

// Configurare Parser XML (Pastram atributele ca @Id, @Name)
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "" 
});

// Helper: Constructia Header-ului Obligatoriu <POS>
const buildBaseXML = (rootTagName) => {
    const root = create({ version: '1.0', encoding: 'utf-8' })
        .ele(rootTagName)
        .ele('POS')
        .ele('Source', { 
            AgentSine: CONFIG.AGENT, 
            City: 'Brasov', 
            ISOCountry: 'RO', 
            ISOCurrency: 'RON', 
            Language: 'RO' 
        })
        .ele('RequestorID', { 
            ID: CONFIG.ID, 
            PASS: CONFIG.PASS 
        })
        .up().up().up(); // Inchide tag-urile
    return root;
};

// Helper: Trimite request catre RezMax
const sendToRezMax = async (xmlString) => {
    const response = await axios.post(CONFIG.URL, { rq: xmlString }, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    
    // Parseaza raspunsul
    const jsonObj = parser.parse(response.data);
    return jsonObj;
};

module.exports = {
    // --- 1. GET CITIES ---
    getDepartureCities: async () => {
        // Construim XML: REZMax_getDepartureCitiesRQ (Pagina 8)
        const xml = buildBaseXML('REZMax_getDepartureCitiesRQ').end({ prettyPrint: false });
        
        const data = await sendToRezMax(xml);
        const root = data.REZMax_getDepartureCitiesRS;

        // Verificare Succes (Pagina 8)
        if (!root || !root.Success) {
            const err = root?.Warnings?.Warning?.ShortText || "Unknown Error";
            throw new Error(err);
        }

        let cityList = root.CityList?.City || [];
        // Daca e un singur oras, parserul il da ca obiect, nu array. Normalizam:
        if (!Array.isArray(cityList)) cityList = [cityList];

        // Mapam la un format curat JSON
        return {
            success: true,
            cities: cityList.map(c => ({
                id: c.Id,
                name: c.Name,
                region: c.RegionName
            }))
        };
    },

    // --- 2. SEARCH BUSES ---
    searchBuses: async (depId, destId, date, seats = 1) => {
        // Construim XML: REZMax_getBusAvailRQ (Pagina 10)
        const doc = buildBaseXML('REZMax_getBusAvailRQ');
        
        // Adaugam parametrii specifici cautarii
        doc.root().ele('OriginDestinationInformation', { ShowAll: 'true', Seats: seats })
            .ele('DepartureDateTime').txt(date).up()
            .ele('OriginLocation', { LocationCode: depId }).up()
            .ele('DestinationLocation', { LocationCode: destId }).up()
        .up();

        const xml = doc.end({ prettyPrint: false });
        const data = await sendToRezMax(xml);
        const root = data.REZMax_getBusAvailRS;

        if (!root || !root.Success) {
            const err = root?.Warnings?.Warning?.ShortText || "No buses found or API Error";
            // RezMax da eroare uneori daca nu gaseste curse, tratam ca lista goala
            if (err.includes("Nu exista curse") || err.includes("No routes")) {
                return { success: true, buses: [] };
            }
            throw new Error(err);
        }

        // Extragem optiunile
        let options = root.OriginDestinationInformation?.OriginDestinationOptions?.OriginDestinationOption || [];
        if (!Array.isArray(options)) options = [options];

        // Procesam datele pentru Botpress
        const buses = options.map(opt => {
            // Extragem segmentul (simplificare: luam primul segment, de obicei e direct)
            let segment = opt.Segment;
            if (Array.isArray(segment)) segment = segment[0]; // Daca sunt mai multe segmente (escale), luam primul pt start

            // Extragem pretul (TicketAvail) - Cautam Adult (*)
            let tickets = segment.TicketAvail || [];
            if (!Array.isArray(tickets)) tickets = [tickets];
            
            const standardTicket = tickets.find(t => t.PassengerType === '*') || tickets[0];

            return {
                optionId: opt.OptionId,
                departureTime: segment.DepartureDateTime?.split('T')[1]?.substring(0, 5), // Doar HH:MM
                arrivalTime: segment.ArrivalDateTime?.split('T')[1]?.substring(0, 5),
                company: segment.MarketingBusline?.CompanyName || "JetCab Partner",
                price: standardTicket ? standardTicket.Price : "N/A",
                currency: standardTicket ? standardTicket.Currency : "RON",
                seatsAvailable: segment.SeatsAvail
            };
        });

        return {
            success: true,
            count: buses.length,
            buses: buses
        };
    }
};