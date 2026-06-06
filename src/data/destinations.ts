import kashmir from "@/assets/kashmir.jpg";
import goa from "@/assets/goa.jpg";
import kerala from "@/assets/kerala.jpg";
import himachal from "@/assets/himachal.jpg";
import vietnam from "@/assets/vietnam.jpg";
import baku from "@/assets/baku.jpg";
import dubai from "@/assets/dubai.jpg";
import singapore from "@/assets/singapore.jpg";
import bangkok from "@/assets/bangkok.jpg";

export type Pkg = {
  name: string;
  price: string;
  tier: string;
  notes: string;
};

export type DayPlan = { day: string; title: string; details: string[] };

export type Destination = {
  slug: string;
  name: string;
  region: "Domestic" | "International";
  country: string;
  nights: string;
  from: string;
  price: string;
  img: string;
  tagline: string;
  hero: string;
  overview: string;
  features: string[];
  benefits: string[];
  bestMonths: string;
  meals: string;
  accommodation: string;
  itinerary: DayPlan[];
  includes: string[];
  excludes: string[];
  packages: Pkg[];
  faqs: { q: string; a: string }[];
};

export const destinations: Destination[] = [
  {
    slug: "kashmir",
    name: "Kashmir",
    region: "Domestic",
    country: "India",
    nights: "6 Nights · 7 Days",
    from: "Ex. Srinagar",
    price: "₹ 35,999",
    img: kashmir,
    tagline: "Shikara dawns on a mirror lake — the valley that earned its 'paradise' epithet.",
    hero: "Six unhurried nights through Srinagar, Sonmarg, Gulmarg and Pahalgam.",
    overview:
      "Six nights and seven days curated end‑to‑end from arrival in Srinagar back to departure. The itinerary covers the four cornerstones every first‑time visitor remembers — Pahalgam, Sonmarg, Srinagar and Gulmarg — with private transfers, considered hotels and a quiet pace that lets the valley reveal itself. Pricing is valid for April–June travel; departures from Ahmedabad and other cities can be quoted on request.",
    features: [
      "Shikara experience on Dal Lake at golden hour",
      "Drive to Sonmarg with optional pony rides at Thajiwas Glacier",
      "Mughal gardens — Chashm‑e‑Shahi, Nishat, Shalimar",
      "Gulmarg day trip with phase‑one Gondola ride included",
      "Chandanwari & Betaab Valley near Pahalgam",
      "Two full days in Pahalgam — Baisaran, Aru Valley, Club House",
    ],
    benefits: [
      "Private, non‑shared transfers in clean sedans/SUVs",
      "Hand‑picked regular or premium hotels on twin sharing",
      "Daily breakfast and dinner included",
      "On‑ground concierge available 24×7 throughout the trip",
      "Transparent inclusions — no last‑minute surprises",
    ],
    bestMonths: "April · May · June",
    meals: "Breakfast & Dinner",
    accommodation: "Regular and Premium hotel options",
    itinerary: [
      {
        day: "Day 1",
        title: "Arrival to Srinagar",
        details: [
          "Pickup from Srinagar Airport and check‑in at the hotel.",
          "Afternoon at leisure — optional Shikara ride on Dal Lake at your own cost.",
          "Dinner and overnight stay in Srinagar.",
        ],
      },
      {
        day: "Day 2",
        title: "Srinagar – Sonmarg – Srinagar",
        details: [
          "Breakfast at the hotel.",
          "Drive 80 km to Sonmarg — a splendid scenic route.",
          "Optional pony ride at Thajiwas Glacier where snow lingers year‑round.",
          "Visit Zero Point before returning to Srinagar for dinner and overnight stay.",
        ],
      },
      {
        day: "Day 3",
        title: "Srinagar Local Sightseeing",
        details: [
          "After breakfast, visit the Mughal gardens — Chashm‑e‑Shahi, Nishat and Shalimar Bagh.",
          "Evening at leisure. Dinner and overnight in Srinagar.",
        ],
      },
      {
        day: "Day 4",
        title: "Srinagar – Gulmarg – Srinagar",
        details: [
          "Drive 56 km to Gulmarg through pine forests and meadows.",
          "Phase‑1 Gondola ride included; phase‑2 to Khilanmarg and pony rides at your own cost.",
          "Return to Srinagar for dinner and overnight stay.",
        ],
      },
      {
        day: "Day 5",
        title: "Srinagar to Pahalgam",
        details: [
          "Check out and drive 92 km to Pahalgam, halting at Chandanwari and Betaab Valley.",
          "Chandanwari sits at ~9,590 ft and is famous for its snow bridge and trekking trails.",
          "Betaab Valley — named after the Bollywood film — is a postcard of streams, meadows and snow.",
          "Dinner and overnight stay in Pahalgam.",
        ],
      },
      {
        day: "Day 6",
        title: "Pahalgam Local Sightseeing",
        details: [
          "After breakfast, visit Baisaran, Aru Valley (in a private taxi at your own cost), Bobby Bungalow and Club House.",
          "Dinner and overnight in Pahalgam.",
        ],
      },
      {
        day: "Day 7",
        title: "Departure from Srinagar",
        details: [
          "Breakfast and check‑out from the hotel.",
          "Drop at Srinagar Airport for your onward flight home.",
        ],
      },
    ],
    includes: [
      "Minimum two persons travelling together",
      "Accommodation on twin sharing — breakfast and dinner included",
      "Pickup and drop from Srinagar",
      "Local sightseeing in non‑AC car",
      "Gondola Phase 1 ticket",
    ],
    excludes: [
      "GST",
      "Airfare / Train fare",
      "Lunch",
      "Personal expenses",
      "Pahalgam sightseeing taxi",
      "Pony rides",
    ],
    packages: [
      {
        tier: "Kashmir Deluxe",
        price: "₹ 35,999",
        notes: "Regular hotels · All standard inclusions · Valid Apr–Jun",
      },
      {
        tier: "Kashmir Super Deluxe",
        price: "₹ 51,499",
        notes: "Premium hotels · All standard inclusions · Valid Apr–Jun",
      },
    ],
    faqs: [
      {
        q: "How much does a Kashmir trip cost?",
        a: "Starting at roughly ₹36,000 per person from Srinagar. From other Indian cities, plan around ₹46,000 per person depending on airfare.",
      },
      {
        q: "Which month is best to visit Kashmir?",
        a: "March and April are exceptional — the Tulip Garden festival in the Valley of Flowers is in full bloom.",
      },
      { q: "Is Kashmir safe to visit?", a: "Yes, Kashmir is safe as of mid‑2024. All major tourist spots are open." },
      {
        q: "Which months are not ideal?",
        a: "July and August coincide with the Amarnath Yatra — hotels fill up and roads to Pahalgam/Sonmarg get congested.",
      },
      {
        q: "Which mobile network works best?",
        a: "Airtel Postpaid is the most reliable in the valley. Prepaid SIMs from outside J&K typically don't work.",
      },
    ],
  },
  {
    slug: "goa",
    name: "Thrilling Goa",
    region: "Domestic",
    country: "India",
    nights: "3 Nights · 4 Days",
    from: "Ex. Goa",
    price: "₹ 8,499",
    img: goa,
    tagline: "Coastline sunsets, beach‑club nights and a city that never quite sleeps.",
    hero: "A short, indulgent break across North and South Goa.",
    overview:
      "Three nights and four days across the two distinct moods of Goa — the cafés, beach clubs and nightlife of the north, and the quiet, palm‑backed shores of the south. We pair boutique stays with curated experiences and easy transfers in between.",
    features: [
      "North Goa: Calangute, Baga, Anjuna and the chapora forts",
      "South Goa: Colva, Palolem and quieter beach hours",
      "Old Goa heritage churches and Latin‑quarter walks in Fontainhas",
      "Optional cruise on the Mandovi River",
      "Spice plantation lunch experience (on request)",
    ],
    benefits: [
      "Hand‑picked beachside or boutique heritage stays",
      "Private cab for all transfers and day trips",
      "Daily breakfast and one signature dinner included",
      "Curated café and beach‑club shortlist for every neighbourhood",
    ],
    bestMonths: "November – February",
    meals: "Breakfast included",
    accommodation: "Regular and Premium beachside hotels",
    itinerary: [
      { day: "Day 1", title: "Arrival in Goa", details: ["Airport pickup and transfer to your hotel.", "Evening at Baga or Candolim — sundowner of your choice."] },
      { day: "Day 2", title: "North Goa Sightseeing", details: ["Calangute, Baga, Anjuna and Vagator beaches.", "Sunset at Chapora Fort followed by dinner in Anjuna."] },
      { day: "Day 3", title: "South Goa & Old Goa", details: ["Heritage churches in Old Goa and Latin‑quarter stroll in Fontainhas.", "Afternoon at Colva or Palolem beach."] },
      { day: "Day 4", title: "Departure", details: ["Breakfast and check‑out.", "Drop at Goa airport for your onward flight."] },
    ],
    includes: ["3 nights accommodation on twin sharing", "Daily breakfast", "Airport pickup and drop", "North & South Goa sightseeing by private cab"],
    excludes: ["GST", "Airfare", "Lunch and dinner", "Entry tickets and water sports", "Personal expenses"],
    packages: [
      { tier: "Goa Standard", price: "₹ 8,499", notes: "3‑star hotels · core inclusions" },
      { tier: "Goa Premium", price: "₹ 14,999", notes: "4‑star beachside resorts · upgraded breakfast" },
    ],
    faqs: [
      { q: "When is the best time to visit Goa?", a: "November to February — pleasant weather, calm seas and the full beach‑club season." },
      { q: "Is Goa good for solo travellers?", a: "Yes — North Goa is especially friendly for solo travellers; we recommend hostels and boutique stays around Anjuna and Vagator." },
    ],
  },
  {
    slug: "kerala",
    name: "Kerala",
    region: "Domestic",
    country: "India",
    nights: "6 Nights · 7 Days",
    from: "Ex. Kochi",
    price: "₹ 19,999",
    img: kerala,
    tagline: "Houseboat hush in the backwaters and tea hills that never end.",
    hero: "Munnar, Thekkady, Alleppey and Kochi — God's Own Country in seven days.",
    overview:
      "Six nights and seven days through Kerala's defining landscapes — Munnar's tea estates, the spice trails of Thekkady, an overnight houseboat on the Alleppey backwaters and a final day in colonial Kochi. Designed for couples and families who want slow, scenic travel.",
    features: [
      "Tea estate visits and Eravikulam National Park drive",
      "Spice plantation walk in Thekkady",
      "Periyar wildlife boat safari",
      "Overnight private houseboat on the Alleppey backwaters",
      "Fort Kochi heritage walk and Chinese fishing nets",
    ],
    benefits: [
      "Air‑conditioned car for all inter‑city transfers",
      "Private deluxe houseboat with all meals onboard",
      "Daily breakfast across the trip",
      "On‑ground travel desk in every city",
    ],
    bestMonths: "September – March",
    meals: "Breakfast daily · all meals on houseboat",
    accommodation: "3‑star hotels & deluxe houseboat",
    itinerary: [
      { day: "Day 1", title: "Arrive Kochi → Munnar", details: ["Pick up at Kochi airport and drive to Munnar (4 hrs).", "Evening at leisure in the hills."] },
      { day: "Day 2", title: "Munnar Sightseeing", details: ["Eravikulam National Park, Mattupetty Dam, Echo Point, tea museum and estate walks."] },
      { day: "Day 3", title: "Munnar → Thekkady", details: ["Drive to Thekkady. Spice plantation walk and Periyar lake boating."] },
      { day: "Day 4", title: "Thekkady → Alleppey Houseboat", details: ["Drive to Alleppey and board your private deluxe houseboat for an overnight cruise."] },
      { day: "Day 5", title: "Alleppey → Kovalam", details: ["Disembark after breakfast and transfer to Kovalam beach. Evening at Lighthouse Beach."] },
      { day: "Day 6", title: "Kovalam → Kochi", details: ["Drive back to Kochi. Fort Kochi heritage walk, Chinese fishing nets, evening Kathakali show."] },
      { day: "Day 7", title: "Departure", details: ["Breakfast and transfer to Kochi airport."] },
    ],
    includes: ["6 nights accommodation incl. houseboat", "Daily breakfast", "All meals on houseboat", "Private AC car for transfers and sightseeing"],
    excludes: ["GST", "Airfare", "Lunch and dinner (off houseboat)", "Park entry fees", "Personal expenses"],
    packages: [
      { tier: "Kerala Classic", price: "₹ 19,999", notes: "3‑star hotels · deluxe houseboat" },
      { tier: "Kerala Luxe", price: "₹ 29,999", notes: "4‑star hotels · premium houseboat with butler" },
    ],
    faqs: [
      { q: "When should we visit Kerala?", a: "September to March — the monsoon is gentler and the backwaters are at their best." },
      { q: "Is the houseboat private?", a: "Yes — every booking includes a private deluxe houseboat with crew and all meals." },
    ],
  },
  {
    slug: "himachal",
    name: "Himachal",
    region: "Domestic",
    country: "India",
    nights: "6 Nights · 7 Days",
    from: "Ex. Delhi",
    price: "₹ 29,999",
    img: himachal,
    tagline: "Pine forests, snow lines and the slow rhythm of the mountains.",
    hero: "Shimla, Manali and Solang in a single, well‑paced loop from Delhi.",
    overview:
      "Six nights through Himachal Pradesh's most loved hill stations. Begin in colonial Shimla, drive up to Manali through apple orchards and pine valleys, with a full day in Solang for snow play and Atal Tunnel sightseeing. Returns to Delhi by overnight Volvo or flight upgrade.",
    features: [
      "Shimla Mall Road and Christ Church walks",
      "Kufri day trip and toy‑train experience (seasonal)",
      "Drive over the Atal Tunnel into Lahaul",
      "Solang Valley for skiing, paragliding and snow play",
      "Manali — Hadimba Temple, Old Manali cafés, Vashisht hot springs",
    ],
    benefits: ["Private vehicle for all transfers and sightseeing", "Carefully selected hotels in central locations", "Daily breakfast and dinner included", "24×7 concierge support in the mountains"],
    bestMonths: "March – June · December – February",
    meals: "Breakfast & Dinner",
    accommodation: "3 / 4‑star hotels",
    itinerary: [
      { day: "Day 1", title: "Delhi → Shimla", details: ["Overnight Volvo or morning drive to Shimla.", "Check in and evening walk on Mall Road."] },
      { day: "Day 2", title: "Shimla Sightseeing", details: ["Kufri, Mashobra and the Indian Institute of Advanced Study."] },
      { day: "Day 3", title: "Shimla → Manali", details: ["Scenic 8‑hour drive via Mandi and the Beas River."] },
      { day: "Day 4", title: "Solang & Atal Tunnel", details: ["Full day in Solang for snow play and adventure sports.", "Drive through the Atal Tunnel for stunning Lahaul views."] },
      { day: "Day 5", title: "Manali Local", details: ["Hadimba Devi Temple, Manu Temple, Vashisht hot springs and Old Manali café trail."] },
      { day: "Day 6", title: "Manali → Delhi", details: ["Day at leisure followed by overnight Volvo back to Delhi."] },
      { day: "Day 7", title: "Arrival in Delhi", details: ["Drop at your hotel or airport on arrival."] },
    ],
    includes: ["Volvo coach Delhi ↔ Manali / Shimla", "6 nights accommodation on twin sharing", "Daily breakfast and dinner", "All sightseeing in private SUV"],
    excludes: ["GST", "Airfare or train fare", "Lunch", "Ropeway & adventure sport tickets", "Personal expenses"],
    packages: [
      { tier: "Himachal Standard", price: "₹ 29,999", notes: "3‑star hotels · Volvo transfers" },
      { tier: "Himachal Premium", price: "₹ 42,999", notes: "4‑star hotels · flight upgrade on return" },
    ],
    faqs: [
      { q: "When can we see snow?", a: "Mid‑December through February for guaranteed snowfall. Higher altitudes around Solang retain snow into March." },
      { q: "Is the Manali drive long?", a: "Yes — Shimla to Manali is around 8 hours on scenic mountain roads. We schedule comfort breaks throughout." },
    ],
  },
  {
    slug: "vietnam",
    name: "Vietnam",
    region: "International",
    country: "South‑East Asia",
    nights: "5 Nights · 6 Days",
    from: "Ex. Hanoi",
    price: "₹ 35,999",
    img: vietnam,
    tagline: "Halong Bay in golden silence — and a country that rewards the slow traveller.",
    hero: "Hanoi, an overnight Halong Bay cruise and the riverside calm of Hoi An.",
    overview:
      "Five nights across Vietnam's headline experiences — the old quarter of Hanoi, an overnight cruise across the limestone karsts of Halong Bay, and the lantern‑lit lanes of Hoi An. Designed for travellers who want both culture and quiet.",
    features: [
      "Hanoi old quarter walking tour and street‑food trail",
      "Overnight luxury cruise on Halong Bay with kayaking and tai chi",
      "Internal flight to Da Nang and transfer to Hoi An",
      "Hoi An ancient town and lantern‑making workshop",
      "My Son sanctuary day trip (optional)",
    ],
    benefits: ["Tourist visa assistance and arrival support", "English‑speaking local guides at each city", "Internal flights included where required", "Airport transfers in private vehicles"],
    bestMonths: "January – April · September – November",
    meals: "Breakfast daily · all meals on cruise",
    accommodation: "4‑star hotels & deluxe cruise cabin",
    itinerary: [
      { day: "Day 1", title: "Arrive Hanoi", details: ["Airport pickup and check in.", "Evening walk around Hoan Kiem Lake and the old quarter."] },
      { day: "Day 2", title: "Halong Bay Overnight Cruise", details: ["Drive to Halong, board the deluxe cruise, kayaking and cave visits, dinner onboard."] },
      { day: "Day 3", title: "Halong → Hanoi → Da Nang", details: ["Disembark after brunch and drive back to Hanoi for an evening flight to Da Nang."] },
      { day: "Day 4", title: "Hoi An Heritage Day", details: ["Old town walk, Japanese covered bridge, lantern workshop and dinner by the river."] },
      { day: "Day 5", title: "Hoi An at Leisure", details: ["Optional My Son sanctuary or cycling through the rice paddies."] },
      { day: "Day 6", title: "Departure", details: ["Transfer to Da Nang airport for your onward flight."] },
    ],
    includes: ["5 nights accommodation incl. cruise", "Daily breakfast", "All meals on Halong cruise", "Internal flight Hanoi → Da Nang", "Visa assistance"],
    excludes: ["International airfare", "Travel insurance", "Lunch and dinner on land", "Personal expenses"],
    packages: [
      { tier: "Vietnam Essential", price: "₹ 35,999", notes: "4‑star hotels · deluxe cruise" },
      { tier: "Vietnam Premium", price: "₹ 52,999", notes: "5‑star hotels · suite cruise cabin" },
    ],
    faqs: [
      { q: "Do Indian passport holders need a visa?", a: "Yes — Vietnam requires a tourist e‑visa. We assist with the application as part of every booking." },
      { q: "Is Halong Bay worth the overnight cruise?", a: "Absolutely — overnight cruises catch sunrise over the karsts, kayaking and quieter caves." },
    ],
  },
  {
    slug: "baku",
    name: "Baku, Azerbaijan",
    region: "International",
    country: "Caucasus",
    nights: "5 Nights · 6 Days",
    from: "Ex. Baku",
    price: "₹ 24,999",
    img: baku,
    tagline: "Old town walls, fire temples and a Caspian skyline of neon glass.",
    hero: "Five nights through Baku, Gobustan and the highland village of Gabala.",
    overview:
      "A compact five‑night route across Azerbaijan — the medieval old city of Baku, the petroglyphs and mud volcanoes of Gobustan, the Zoroastrian fire temple at Ateshgah and a highland day in Gabala. Modern, affordable and unusually photogenic.",
    features: [
      "Walking tour of Icherisheher (old city) and Maiden Tower",
      "Flame Towers viewpoint and Highland Park sunset",
      "Gobustan petroglyphs and mud volcanoes day trip",
      "Ateshgah Fire Temple and Yanardag burning hillside",
      "Gabala — Tufandag cable car and Nohur Lake",
    ],
    benefits: ["Visa on arrival assistance (Indian passport)", "English‑speaking local guides", "Air‑conditioned vehicles for all sightseeing", "Carefully chosen city‑centre hotels"],
    bestMonths: "April – June · September – October",
    meals: "Breakfast daily",
    accommodation: "4‑star hotels in Baku & Gabala",
    itinerary: [
      { day: "Day 1", title: "Arrive Baku", details: ["Airport pickup and transfer to your hotel.", "Evening walk along the Caspian boulevard."] },
      { day: "Day 2", title: "Baku City Tour", details: ["Icherisheher, Maiden Tower, Heydar Aliyev Center and Flame Towers viewpoint."] },
      { day: "Day 3", title: "Gobustan & Absheron", details: ["Petroglyphs, mud volcanoes, Ateshgah Fire Temple and Yanardag."] },
      { day: "Day 4", title: "Baku → Gabala", details: ["Scenic drive to Gabala, Tufandag cable car and an evening at the resort."] },
      { day: "Day 5", title: "Gabala → Baku", details: ["Nohur Lake, Seven Beauties waterfall and return to Baku."] },
      { day: "Day 6", title: "Departure", details: ["Breakfast and transfer to Baku airport."] },
    ],
    includes: ["5 nights accommodation", "Daily breakfast", "All transfers and sightseeing in private vehicle", "English‑speaking local guide"],
    excludes: ["International airfare", "Azerbaijan e‑visa fee", "Lunch & dinner", "Personal expenses"],
    packages: [
      { tier: "Baku Essential", price: "₹ 24,999", notes: "4‑star hotels · all listed inclusions" },
      { tier: "Baku Premium", price: "₹ 36,999", notes: "5‑star hotels · upgraded Gabala resort" },
    ],
    faqs: [
      { q: "Is Azerbaijan easy for Indian travellers?", a: "Yes — Azerbaijan offers a quick e‑visa to Indian passport holders. We handle the application end‑to‑end." },
      { q: "Is it expensive?", a: "It's one of the most affordable international destinations from India — comparable to a long Goa break." },
    ],
  },
  {
    slug: "dubai",
    name: "Dubai",
    region: "International",
    country: "United Arab Emirates",
    nights: "5 Nights · 6 Days",
    from: "Ex. Dubai",
    price: "₹ 36,999",
    img: dubai,
    tagline: "Desert dunes by morning, sky‑high cocktails by night.",
    hero: "Five nights across Dubai and Abu Dhabi — city, desert and coast.",
    overview:
      "Five nights designed to balance Dubai's modern theatre with the older charm of Abu Dhabi. Includes a city tour, dune safari with BBQ dinner, Burj Khalifa entry and a full day at the Sheikh Zayed Grand Mosque and Ferrari World.",
    features: [
      "Dubai city tour — Burj Al Arab, Palm Jumeirah, Old Dubai souks",
      "Burj Khalifa observation deck (level 124)",
      "Evening desert safari with BBQ dinner and live shows",
      "Dhow cruise on Dubai Marina with dinner",
      "Full‑day Abu Dhabi with Sheikh Zayed Grand Mosque & Louvre",
    ],
    benefits: ["UAE visa processing handled in‑house", "Indian, Asian and Continental meals onboard the cruise and safari", "Private SIC transfers throughout", "24×7 destination concierge"],
    bestMonths: "November – March",
    meals: "Breakfast daily · dinner on safari and cruise",
    accommodation: "4 / 5‑star hotels on Sheikh Zayed Road",
    itinerary: [
      { day: "Day 1", title: "Arrival in Dubai", details: ["Airport pickup and check in.", "Evening at leisure on Sheikh Zayed Road."] },
      { day: "Day 2", title: "Dubai City Tour", details: ["Burj Al Arab, Palm Jumeirah Monorail, Old Dubai souks and the Dubai Frame."] },
      { day: "Day 3", title: "Desert Safari", details: ["Afternoon dune bashing, camel ride, henna, BBQ dinner with belly dance and tanoura shows."] },
      { day: "Day 4", title: "Abu Dhabi Day Trip", details: ["Sheikh Zayed Grand Mosque, Emirates Palace and Ferrari World (entry optional)."] },
      { day: "Day 5", title: "Burj Khalifa & Marina Cruise", details: ["Level 124 of Burj Khalifa, Dubai Mall fountain show and an evening dinner cruise on the Marina."] },
      { day: "Day 6", title: "Departure", details: ["Breakfast and transfer to Dubai airport."] },
    ],
    includes: ["5 nights 4‑star accommodation", "Daily breakfast", "All transfers on SIC basis", "Burj Khalifa, Marina Cruise, Desert Safari, Abu Dhabi tour", "UAE visa"],
    excludes: ["International airfare", "Travel insurance", "Lunch", "Optional tickets — Ferrari World, Atlantis Aquaventure", "Personal expenses"],
    packages: [
      { tier: "Dubai Essential", price: "₹ 36,999", notes: "4‑star hotels · all listed inclusions" },
      { tier: "Dubai Luxe", price: "₹ 58,999", notes: "5‑star hotels · private transfers · upgraded cruise" },
    ],
    faqs: [
      { q: "Is the UAE visa included?", a: "Yes — 14‑day tourist visa is included. Faster express options are available on request." },
      { q: "What is the best time?", a: "November to March — dry, mild and the season for outdoor dining and desert evenings." },
    ],
  },
  {
    slug: "singapore-malaysia",
    name: "Singapore & Malaysia",
    region: "International",
    country: "South‑East Asia",
    nights: "6 Nights · 7 Days",
    from: "Ex. Delhi",
    price: "₹ 58,499",
    img: singapore,
    tagline: "Two skylines, two moods — Marina Bay and the Petronas Towers in one trip.",
    hero: "Three nights in Singapore, three nights in Kuala Lumpur with Genting Highlands.",
    overview:
      "Six nights covering the two anchor cities of South‑East Asia. Begin in Singapore with Sentosa, Universal Studios and Gardens by the Bay, then cross to Kuala Lumpur for Batu Caves, the Petronas Twin Towers and a day in Genting Highlands' cool, alpine air.",
    features: [
      "Singapore half‑day city tour and Marina Bay night walk",
      "Universal Studios full day at Sentosa",
      "Gardens by the Bay with Cloud Forest entry",
      "KL city tour — Petronas Towers, Batu Caves, Putrajaya",
      "Genting Highlands cable‑car day trip",
    ],
    benefits: ["Visa assistance for both Singapore and Malaysia", "Internal Singapore ↔ KL flight or coach transfer", "English‑speaking SIC tours", "Centrally located 4‑star hotels"],
    bestMonths: "February – April · July – September",
    meals: "Breakfast daily · selective Indian dinners",
    accommodation: "4‑star hotels in both cities",
    itinerary: [
      { day: "Day 1", title: "Arrive Singapore", details: ["Airport pickup. Evening at Marina Bay Sands and the Spectra light show."] },
      { day: "Day 2", title: "Singapore City Tour", details: ["Merlion Park, Chinatown, Little India, Orchard Road and Gardens by the Bay (Cloud Forest entry)."] },
      { day: "Day 3", title: "Sentosa & Universal Studios", details: ["Full day at Universal Studios followed by the Wings of Time night show."] },
      { day: "Day 4", title: "Singapore → Kuala Lumpur", details: ["Flight or coach transfer to KL. Evening walk on Bukit Bintang."] },
      { day: "Day 5", title: "KL City + Putrajaya", details: ["Petronas Towers photo stop, KL Tower, Batu Caves and a Putrajaya drive."] },
      { day: "Day 6", title: "Genting Highlands Day Trip", details: ["Awana Skyway cable car, Sky Avenue mall and casino floor (optional)."] },
      { day: "Day 7", title: "Departure", details: ["Breakfast and transfer to KLIA for your onward flight."] },
    ],
    includes: ["6 nights 4‑star accommodation", "Daily breakfast", "All SIC transfers and tours", "Internal flight/coach SIN → KL", "Universal Studios one‑day pass"],
    excludes: ["International airfare", "Visa fees for Singapore & Malaysia", "Lunch and dinner", "Optional ride passes at Genting", "Personal expenses"],
    packages: [
      { tier: "SG/MY Essential", price: "₹ 58,499", notes: "4‑star hotels · all listed inclusions" },
      { tier: "SG/MY Premium", price: "₹ 79,999", notes: "5‑star hotels · private transfers · upgraded park passes" },
    ],
    faqs: [
      { q: "Is the trip family friendly?", a: "Yes — Universal Studios, Genting and Gardens by the Bay are designed around families." },
      { q: "Singapore visa lead time?", a: "Plan 7–10 working days. We handle the application end‑to‑end." },
    ],
  },
  {
    slug: "bangkok-pattaya",
    name: "Bangkok & Pattaya",
    region: "International",
    country: "Thailand",
    nights: "4 Nights · 5 Days",
    from: "Ex. Bangkok",
    price: "₹ 13,499",
    img: bangkok,
    tagline: "Temples, tuk‑tuks, beach clubs — Thailand's headline pair in one short hop.",
    hero: "Two nights in Bangkok, two nights in Pattaya with Coral Island.",
    overview:
      "Four nights across Thailand's two most popular hubs. Begin in Bangkok with the Grand Palace and a temple trail, transfer to Pattaya for Coral Island, Sanctuary of Truth and the Walking Street experience. One of the easiest, best‑value international breaks you can take from India.",
    features: [
      "Bangkok temple trail — Grand Palace, Wat Pho, Wat Arun",
      "Optional dinner cruise on the Chao Phraya river",
      "Pattaya transfer with stop at Nong Nooch garden",
      "Coral Island day trip with speedboat and lunch",
      "Sanctuary of Truth visit and Walking Street evening",
    ],
    benefits: ["Visa on arrival assistance", "Indian meals available at selected restaurants", "English‑speaking SIC tours throughout", "City‑centre hotels in both Bangkok and Pattaya"],
    bestMonths: "November – February",
    meals: "Breakfast daily · lunch on Coral Island",
    accommodation: "3 / 4‑star hotels",
    itinerary: [
      { day: "Day 1", title: "Arrive Bangkok", details: ["Airport pickup and check in.", "Evening at leisure or optional Chao Phraya dinner cruise."] },
      { day: "Day 2", title: "Bangkok City + Temples", details: ["Grand Palace, Wat Pho and Wat Arun. Afternoon shopping at MBK or ICONSIAM."] },
      { day: "Day 3", title: "Bangkok → Pattaya", details: ["Transfer to Pattaya with a stop at Nong Nooch tropical gardens. Evening at Walking Street."] },
      { day: "Day 4", title: "Coral Island Day Trip", details: ["Speedboat to Coral Island, lunch, optional parasailing and an evening at the Sanctuary of Truth."] },
      { day: "Day 5", title: "Departure", details: ["Breakfast and transfer back to Bangkok airport."] },
    ],
    includes: ["4 nights accommodation on twin sharing", "Daily breakfast", "Coral Island tour with lunch", "Bangkok city + temple tour", "All SIC transfers"],
    excludes: ["International airfare", "Visa on arrival fee", "Lunch and dinner (off Coral Island)", "Optional adventure activities", "Personal expenses"],
    packages: [
      { tier: "Thailand Standard", price: "₹ 13,499", notes: "3‑star hotels · all listed inclusions" },
      { tier: "Thailand Premium", price: "₹ 22,999", notes: "4‑star hotels · Chao Phraya cruise · upgraded transfers" },
    ],
    faqs: [
      { q: "Is visa on arrival easy?", a: "Yes — Indian passport holders can avail visa on arrival. We provide the latest checklist before departure." },
      { q: "When is Thailand best?", a: "November to February — dry, mild and the peak season for islands and beaches." },
    ],
  },
];

export const getDestination = (slug: string) => destinations.find((d) => d.slug === slug);
export const domesticDestinations = destinations.filter((d) => d.region === "Domestic");
export const internationalDestinations = destinations.filter((d) => d.region === "International");
