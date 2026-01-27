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
    // Logheaza un pic din raspuns ca sa stim ca serverul traieste
    if(response.data) console.log("[RezMax Net Response]:", response.data.substring(0, 100) + "...");
    return parser.parse(response.data);
};

module.exports = {
    // --- 1. ORASE (Merge deja) ---
    getDepartureCities: async () => {
        const xml = buildBaseXML('REZMax_getDepartureCitiesRQ').end({ prettyPrint: false });
        try {
            const data = await sendToRezMax(xml);
            const root = data.REZMax_getDepartureCitiesRS;

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

    // --- 2. CAUTARE CURSE---
    searchBuses: async (depId, destId, date, seats = 1) => {
        console.log(`[SERVICE] START Cautare: ${depId} -> ${destId} pe data ${date}`);
        
        const doc = buildBaseXML('REZMax_getBusAvailRQ');
        doc.root().ele('OriginDestinationInformation', { ShowAll: 'true', Seats: seats })
            .ele('DepartureDateTime').txt(date).up()
            .ele('OriginLocation', { LocationCode: depId }).up()
            .ele('DestinationLocation', { LocationCode: destId }).up()
        .up();

        const xml = doc.end({ prettyPrint: false });
        
        try {
            const data = await sendToRezMax(xml);
            const root = data.REZMax_getBusAvailRS;

            // --- MESAJUL REAL DE LA REZMAX ---
            console.log("🔍 [REZMAX RAW RASPUNS]:", JSON.stringify(root));

            if (!root) {
                return { success: false, count: 0, error: "Raspuns gol de la server" };
            }

            // Verificam daca exista erori explicite
            if (root.Errors || (root.Warnings && root.Success === undefined)) {
                 const errObj = root.Errors || root.Warnings;
                 console.log("⚠️ [REZMAX REFUZ]:", JSON.stringify(errObj));
            }

            // Extragem optiunile de calatorie
            let options = root.OriginDestinationInformation?.OriginDestinationOptions?.OriginDestinationOption || [];
            if (!Array.isArray(options)) options = [options];

            const buses = options.map(opt => {
                let segment = opt.Segment;
                if (Array.isArray(segment)) segment = segment[0];
                
                if (!segment) return null;

                let tickets = segment.TicketAvail || [];
                if (!Array.isArray(tickets)) tickets = [tickets];
                const standardTicket = tickets.find(t => t.PassengerType === '*') || tickets[0];

                return {
                    optionId: opt.OptionId,
                    departureTime: segment.DepartureDateTime?.split('T')[1]?.substring(0, 5),
                    arrivalTime: segment.ArrivalDateTime?.split('T')[1]?.substring(0, 5),
                    company: segment.MarketingBusline?.CompanyName || "Partener JetCab",
                    price: standardTicket ? standardTicket.Price : "N/A",
                    currency: standardTicket ? standardTicket.Currency : "RON"
                };
            }).filter(b => b !== null); // Scoatem elementele null

            return { success: true, count: buses.length, buses: buses };

        } catch (e) {
            console.error("[SERVICE ERROR] Search failed:", e.message);
            // Returnam 0 curse safe, dar cu mesaj de eroare in consola
            return { success: false, error: e.message, count: 0, buses: [] };
        }
    }
};
