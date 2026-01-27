const axios = require('axios');
const { create } = require('xmlbuilder2');
const { XMLParser } = require('fast-xml-parser');

// Configurare Credentiale
const CONFIG = {
    URL: process.env.REZMAX_URL || 'https://rezmax.ro/Services/Ticketing.aspx',
    AGENT: process.env.REZMAX_AGENT || 'JetCab',
    ID: process.env.REZMAX_ID,
    PASS: process.env.REZMAX_PASS
};

// Configurare Parser XML
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ""
});

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
        .up().up().up();
    return root;
};

const sendToRezMax = async (xmlString) => {
    const params = new URLSearchParams();
    params.append('rq', xmlString);

    const response = await axios.post(CONFIG.URL, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    // Log doar primele 200 caractere pentru debug
    if(response.data) console.log("[RezMax Response Head]:", response.data.substring(0, 200));
    return parser.parse(response.data);
};

module.exports = {
    getDepartureCities: async () => {
        const xml = buildBaseXML('REZMax_getDepartureCitiesRQ').end({ prettyPrint: false });
        try {
            const data = await sendToRezMax(xml);
            const root = data.REZMax_getDepartureCitiesRS;

            // FIX: Verificam daca proprietatea EXISTA, nu daca are valoare (pt ca <Success/> e gol)
            if (!root || root.Success === undefined) {
                console.error("API Error Dump:", JSON.stringify(root));
                throw new Error("API Error or No Success Tag");
            }

            let cityList = root.CityList?.City || [];
            if (!Array.isArray(cityList)) cityList = [cityList];

            return {
                success: true,
                cities: cityList.map(c => ({
                    id: c.Id,
                    name: c.Name,
                    region: c.RegionName
                }))
            };
        } catch (e) {
            console.error("Error getDepartureCities:", e.message);
            throw e;
        }
    },

    searchBuses: async (depId, destId, date, seats = 1) => {
        const doc = buildBaseXML('REZMax_getBusAvailRQ');
        doc.root().ele('OriginDestinationInformation', { ShowAll: 'true', Seats: seats })
            .ele('DepartureDateTime').txt(date).up()
            .ele('OriginLocation', { LocationCode: depId }).up()
            .ele('DestinationLocation', { LocationCode: destId }).up()
        .up();

        const xml = doc.end({ prettyPrint: false });
        const data = await sendToRezMax(xml);
        const root = data.REZMax_getBusAvailRS;

        // FIX: Aceeasi corectie pentru Success
        if (!root || root.Success === undefined) {
            // Daca nu e succes, verificam daca e eroare reala sau doar lipsa curse
            let err = "Unknown Error";
            if (root?.Warnings?.Warning) {
                const w = root.Warnings.Warning;
                err = w.ShortText || JSON.stringify(w);
            }
            // RezMax poate da eroare daca nu sunt curse, tratam ca lista goala
            if (err.includes("Nu exista curse") || err.includes("No routes")) {
                return { success: true, buses: [] };
            }
            // Altfel e eroare tehnica
            console.error("Search Error Dump:", JSON.stringify(root));
            return { success: true, buses: [] }; // Returnam gol safe
        }

        let options = root.OriginDestinationInformation?.OriginDestinationOptions?.OriginDestinationOption || [];
        if (!Array.isArray(options)) options = [options];

        const buses = options.map(opt => {
            let segment = opt.Segment;
            if (Array.isArray(segment)) segment = segment[0];
            let tickets = segment.TicketAvail || [];
            if (!Array.isArray(tickets)) tickets = [tickets];
            const standardTicket = tickets.find(t => t.PassengerType === '*') || tickets[0];

            return {
                optionId: opt.OptionId,
                departureTime: segment.DepartureDateTime?.split('T')[1]?.substring(0, 5),
                arrivalTime: segment.ArrivalDateTime?.split('T')[1]?.substring(0, 5),
                company: segment.MarketingBusline?.CompanyName || "JetCab",
                price: standardTicket ? standardTicket.Price : "N/A",
                currency: standardTicket ? standardTicket.Currency : "RON"
            };
        });

        return { success: true, count: buses.length, buses: buses };
    }
};
