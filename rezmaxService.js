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

// Configurare Parser
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

    console.log("[DEBUG REQUEST] XML Trimis:", xmlString);

    try {
        const response = await axios.post(CONFIG.URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const rawData = response.data;
        
        // Verificare raspuns gol sau eroare textuala
        if (!rawData || typeof rawData !== 'string' || rawData.includes("Comanda necunoscuta")) {
            console.error("[CRITIC] Raspuns invalid de la RezMax:", rawData);
            return { invalidResponse: true, raw: rawData };
        }

        return parser.parse(rawData);
    } catch (error) {
        console.error("[AXIOS ERROR]", error.message);
        throw error;
    }
};

module.exports = {
    // 1. ORASE
    getDepartureCities: async () => {
        const xml = buildBaseXML('REZMax_getDepartureCitiesRQ').end({ prettyPrint: false });
        try {
            const data = await sendToRezMax(xml);
            const root = data.REZMax_getDepartureCitiesRS;

            if (!root || root.Success === undefined) throw new Error("API Error");

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

    // 2. CAUTARE CURSE
    searchBuses: async (depId, destId, date, seats = 1) => {
        console.log(`[SERVICE] Cautare: ${depId} -> ${destId} pe ${date}`);
        
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

            if (!root || !root.OriginDestinationInformation) return { success: false, count: 0, error: "Raspuns gol" };

            const info = root.OriginDestinationInformation;
            let options = info?.Options?.Option;
            
            // Fallback structures
            if (!options) options = info?.OriginDestinationOptions?.OriginDestinationOption;
            if (!options) options = [];
            if (!Array.isArray(options)) options = [options];

            console.log(`[SERVICE] Am gasit ${options.length} optiuni brute.`);

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
                    company: segment.MarketingBusline?.CompanyName || "JetCab",
                    price: standardTicket ? standardTicket.Price : "N/A",
                    currency: standardTicket ? standardTicket.Currency : "RON"
                };
            }).filter(b => b !== null);

            return { success: true, count: buses.length, buses: buses };

        } catch (e) {
            return { success: false, error: e.message, count: 0, buses: [] };
        }
    },

    // 3. DETALII CURSA (UPDATE: Extragem SeatSelect)
    getTripDetails: async (optionId, date) => {
        const doc = buildBaseXML('REZMax_getTripDetailsRQ');
        doc.root().ele('Trip', { OptionId: optionId, DepartureDateTime: date }).up();
        
        try {
            const data = await sendToRezMax(doc.end({ prettyPrint: false }));
            const root = data.REZMax_getTripDetailsRS;
            
            if (!root || !root.Segments) throw new Error("Nu am putut obtine detaliile cursei.");

            let segment = root.Segments.Segment;
            if (Array.isArray(segment)) segment = segment[0]; 

            // LOGIC CHECK: SeatSelect="1" inseamna ca putem alege locul
            const canSelect = segment.SeatSelect === "1";
            console.log(`[DETAILS] LinkId: ${segment.LinkId}, SeatSelect: ${segment.SeatSelect} (CanSelect: ${canSelect})`);

            return {
                success: true,
                linkId: segment.LinkId,
                departureDate: segment.DepartureDate || date,
                seatSelect: canSelect // Trimitem asta mai departe
            };

        } catch (e) {
            console.error("[SERVICE ERROR] getTripDetails:", e.message);
            return { success: false, error: e.message };
        }
    },

    // 4. HARTA LOCURILOR (UPDATE: Corectat Tag XML)
    getBusSeats: async (linkId, date) => {
        console.log(`[SERVICE] GetBusSeats pt ${linkId}`);
        
        // CORECTIE MAJORA: G mare la GetBusSeats
        const doc = buildBaseXML('REZMax_GetBusSeatsRQ');
        doc.root().ele('Segment', { OptionId: linkId, Date: date }).up();

        try {
            const data = await sendToRezMax(doc.end({ prettyPrint: false }));
            
            if (data.invalidResponse) {
                return { success: false, error: "Eroare comanda RezMax: " + data.raw };
            }

            // Cautam raspunsul cu G mare sau g mic
            const root = data.REZMax_GetBusSeatsRS || data.REZMax_getBusSeatsRS;

            if (!root || !root.Bus || !root.Bus.Seats) {
                return { success: false, error: "Harta locurilor nu este disponibila." };
            }

            const rows = root.Bus.Seats.Row;
            const seatsMap = [];
            const rowsArray = Array.isArray(rows) ? rows : [rows];
            
            rowsArray.forEach((row, rowIndex) => {
                let seats = row.Seat;
                if (!seats) return;
                if (!Array.isArray(seats)) seats = [seats];

                seats.forEach(seat => {
                    if (seat.N) {
                        seatsMap.push({
                            number: seat.N,
                            isOccupied: seat.O === "1",
                            row: rowIndex + 1
                        });
                    }
                });
            });

            return {
                success: true,
                totalSeats: seatsMap.length,
                availableSeats: seatsMap.filter(s => !s.isOccupied).map(s => s.number),
                fullMap: seatsMap
            };

        } catch (e) {
            console.error("[SERVICE ERROR] getBusSeats:", e.message);
            return { success: false, error: e.message };
        }
    }
};
