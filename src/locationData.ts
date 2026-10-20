// Complete Country, State, District, and Village/Locality dataset for Smart Diagno

export type Country = {
  code: string;
  name: string;
};

export const COUNTRIES: Country[] = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "AE", name: "United Arab Emirates" },
];

export type StateData = {
  name: string;
  districts: {
    name: string;
    villages?: string[];
  }[];
};

export const INDIA_STATES: Record<string, StateData> = {
  "Telangana": {
    name: "Telangana",
    districts: [
      {
        name: "Hyderabad",
        villages: [
          "Ameerpet", "Banjara Hills", "Jubilee Hills", "Gachibowli", "Madhapur", "Hitech City",
          "Kukatpally", "Secunderabad", "Begumpet", "Mehdipatnam", "Charminar", "Koti",
          "Dilsukhnagar", "LB Nagar", "Malakpet", "Sanathnagar", "Panjagutta", "Somajiguda",
          "Kondapur", "Miyapur", "Tarnaka", "Uppal", "Bowenpally", "Abids", "Nampally",
          "Himayatnagar", "Khairatabad", "Lakdikapul", "Musheerabad", "Narayanaguda", "Amberpet",
          "SR Nagar", "Erragadda", "Moosapet", "Chanda Nagar", "Lingampally", "Tolichowki",
          "Shaikpet", "Manikonda", "Attapur", "Rajendranagar", "Santosh Nagar", "Chandrayangutta",
          "Golconda", "Asif Nagar", "Karwan", "Bahadurpura", "Falaknuma"
        ],
      },
      {
        name: "Medchal-Malkajgiri",
        villages: [
          "Kompally", "Medchal", "Malkajgiri", "Alwal", "Ghatkesar", "Kushaiguda", "ECIL",
          "Quthbullapur", "Dundigal", "Keesara", "Jeedimetla", "Bowrampet", "Jawaharnagar",
          "Medipally", "Boduppal", "Peerzadiguda", "Shamirpet", "Neredmet", "Yapral", "Sainikpuri"
        ],
      },
      {
        name: "Rangareddy",
        villages: [
          "Shamshabad", "Rajendranagar", "Ibrahimpatnam", "Maheshwaram", "Shadnagar", "Chevella",
          "Manikonda", "Gandipet", "Kokapet", "Mokila", "Shankarpally", "Kothur", "Farooqnagar",
          "Amangal", "Kandukur", "Yacharam", "Hayathnagar", "Vanasthalipuram", "Karmanghat"
        ],
      },
      {
        name: "Sangareddy",
        villages: [
          "Sangareddy Town", "Patancheru", "Ameenpur", "Beeramguda", "Ramachandrapuram",
          "Zaheerabad", "Sadasivpet", "Jinnaram", "Kandi", "Kohir", "Mogudampally"
        ],
      },
      {
        name: "Warangal",
        villages: [
          "Warangal City", "Geesugonda", "Wardhannapet", "Parvathagiri", "Rayaparthy",
          "Duggondi", "Nekkonda", "Nallabelly", "Chennaraopet"
        ],
      },
      {
        name: "Hanamkonda",
        villages: [
          "Hanamkonda City", "Kazipet", "Subedari", "Nakkalagutta", "Waddepally", "Hunter Road",
          "Balasamudram", "Bhimaram", "Hasanparthy", "Kamalapur", "Elkathurthy", "Dharmasagar"
        ],
      },
      {
        name: "Nizamabad",
        villages: [
          "Nizamabad City", "Armoor", "Bodhan", "Banswada", "Kotgiri", "Varni", "Navipet",
          "Dichpally", "Dharpally", "Jakranpally", "Balkonda", "Mupkal", "Morangal", "Yedpally"
        ],
      },
      {
        name: "Karimnagar",
        villages: [
          "Karimnagar City", "Choppadandi", "Manakondur", "Gangadhara", "Ramadugu", "Thimmapur",
          "Ganneruvaru", "Chigurumamidi", "Kothapalli", "Huzurabad", "Jammikunta", "Veenavanka"
        ],
      },
      {
        name: "Khammam",
        villages: [
          "Khammam City", "Madhira", "Sathupalli", "Wyra", "Kalluru", "Thirumalayapalem",
          "Kusumanchi", "Nelakondapalli", "Bonakal", "Chinthakani", "Enkoor"
        ],
      },
      {
        name: "Nalgonda",
        villages: [
          "Nalgonda Town", "Miryalaguda", "Devarakonda", "Nakrekal", "Chityal", "Halim Nagar",
          "Munugode", "Chandur", "Kethepally", "Tipparthy", "Narketpally"
        ],
      },
      {
        name: "Mahbubnagar",
        villages: [
          "Mahbubnagar Town", "Jadcherla", "Bhoothpur", "Devarkadra", "Hanwada", "Koilkonda",
          "Nawabpet", "Midjil", "Balanagar", "Rajapur"
        ],
      },
      {
        name: "Siddipet",
        villages: [
          "Siddipet Town", "Gajwel", "Dubbak", "Husnabad", "Cherial", "Mulkanoor", "Kondapak",
          "Jagdevpur", "Markook", "Mulug", "Wargal"
        ],
      },
      {
        name: "Suryapet",
        villages: [
          "Suryapet Town", "Kodad", "Huzurnagar", "Mothey", "Chivemla", "Atmakur(S)",
          "Munagala", "Neredcherla", "Garidepally", "Penpahad"
        ],
      },
      {
        name: "Adilabad",
        villages: ["Adilabad Town", "Utnoor", "Boath", "Bela", "Jainath", "Bazarhathnoor", "Gudihatnur", "Indervelly"],
      },
      {
        name: "Mancherial",
        villages: ["Mancherial Town", "Bellampalli", "Mandamarri", "Chennur", "Luxettipet", "Kyathanpalli", "Naspur"],
      },
      {
        name: "Nirmal",
        villages: ["Nirmal Town", "Bhainsa", "Khanapur", "Kaddampeddur", "Mamada", "Laxmanchanda", "Soan"],
      },
      {
        name: "Jagtial",
        villages: ["Jagtial Town", "Korutla", "Metpalli", "Raikal", "Dharmapuri", "Gollapalli", "Mallial"],
      },
      {
        name: "Rajanna Sircilla",
        villages: ["Sircilla Town", "Vemulawada", "Boinpalli", "Yellareddypet", "Gambhiraopet", "Mustabad"],
      },
      {
        name: "Peddapalli",
        villages: ["Peddapalli Town", "Ramagundam", "Godavarikhani", "Sultanabad", "Manthani", "Julapalli", "Kamanpur"],
      },
      {
        name: "Kamareddy",
        villages: ["Kamareddy Town", "Banswada", "Yellareddy", "Bhiknoor", "Domakonda", "Machareddy", "Gandhari"],
      },
      {
        name: "Medak",
        villages: ["Medak Town", "Narsapur", "Chegunta", "Ramayampet", "Shankarampet", "Havelighanpur", "Papannapet"],
      },
      {
        name: "Vikarabad",
        villages: ["Vikarabad Town", "Tandur", "Pargi", "Kodangal", "Nawabpet", "Mominpet", "Doma", "Dharur"],
      },
      {
        name: "Yadadri Bhuvanagiri",
        villages: ["Bhongir (Bhuvanagiri)", "Yadagirigutta", "Alair", "Choutuppal", "Mothkur", "Bommalaramaram", "Pochampally"],
      },
      {
        name: "Bhadradri Kothagudem",
        villages: ["Kothagudem Town", "Bhadrachalam", "Palwancha", "Yellandu", "Manuguru", "Burgampahad", "Aswapuram"],
      },
      {
        name: "Mahabubabad",
        villages: ["Mahabubabad Town", "Thorrur", "Kesamudram", "Dornakal", "Nellikudur", "Kuravi", "Garla"],
      },
      {
        name: "Jangaon",
        villages: ["Jangaon Town", "Station Ghanpur", "Palakurthi", "Zaffergadh", "Bachannapet", "Devaruppula"],
      },
      {
        name: "Wanaparthy",
        villages: ["Wanaparthy Town", "Pebbair", "Kothakota", "Ghanpur", "Pangal", "Revally", "Gopalpeta"],
      },
      {
        name: "Nagarkurnool",
        villages: ["Nagarkurnool Town", "Achampet", "Kalwakurthy", "Kollapur", "Telkapally", "Bijinapally", "Amrabad"],
      },
      {
        name: "Jogulamba Gadwal",
        villages: ["Gadwal Town", "Alampur", "Ieeja", "Itikyal", "Manoor", "Maldakal", "Dharoor", "Ghattu"],
      },
      {
        name: "Narayanpet",
        villages: ["Narayanpet Town", "Makthal", "Kosgi", "Damargidda", "Maddur", "Utkoor", "Maganoor"],
      },
      {
        name: "Jayashankar Bhupalpally",
        villages: ["Bhupalpally Town", "Kataram", "Mahadevpur", "Malhar Rao", "Mogullapally", "Chityal"],
      },
      {
        name: "Mulugu",
        villages: ["Mulugu Town", "Venkatapur", "Govindaraopet", "Tadvai", "Eturnagaram", "Mangapet", "Wazeed"],
      },
      {
        name: "Kumuram Bheem Asifabad",
        villages: ["Asifabad Town", "Kagaznagar", "Sirpur (T)", "Wankidi", "Rebbena", "Kerameri", "Jainoor"],
      },
    ],
  },
  "Andhra Pradesh": {
    name: "Andhra Pradesh",
    districts: [
      {
        name: "Visakhapatnam",
        villages: [
          "MVP Colony", "Gajuwaka", "Madhurawada", "Dwaraka Nagar", "Jagadamba Centre",
          "Seethammadhara", "Rushikonda", "Pendurthi", "Gopalapatnam", "Simhachalam",
          "Anakapalle", "Bheemunipatnam", "Arilova", "Maharani Peta", "Asilmetta"
        ],
      },
      {
        name: "NTR (Vijayawada)",
        villages: [
          "Benz Circle", "Governorpet", "Suryaraopet", "Moghalrajpuram", "Gunadala",
          "Patamata", "Bhavanipuram", "One Town", "Ajit Singh Nagar", "Poranki", "Kankipadu",
          "Gannavaram", "Ibrahimpatnam", "Mylavaram", "Tiruvuru", "Nandigama", "Jaggayyapeta"
        ],
      },
      {
        name: "Guntur",
        villages: [
          "Guntur City", "Arundelpet", "Brodipet", "Kothapet", "Pattabhipuram", "Tenali",
          "Mangalagiri", "Tadikonda", "Pedakakani", "Chebrolu", "Ponnur", "Medikonduru"
        ],
      },
      {
        name: "Tirupati",
        villages: [
          "Tirupati City", "Renigunta", "Chandragiri", "Srikalahasti", "Gudur", "Naidupeta",
          "Sullurpeta", "Venkatagiri", "Yerpedu", "Pakala", "Tirumala"
        ],
      },
      {
        name: "Krishna",
        villages: [
          "Machilipatnam", "Gudivada", "Vuyyuru", "Pamarru", "Avanigadda", "Challapalli",
          "Bantumilli", "Kaikalur", "Movva", "Nagayalanka"
        ],
      },
      {
        name: "Kurnool",
        villages: ["Kurnool City", "Adoni", "Yemmiganur", "Kodumur", "Gudur", "Alur", "Pattikonda", "Nandyal Road"],
      },
      {
        name: "Anantapur",
        villages: ["Anantapur City", "Guntakal", "Tadipatri", "Dharmavaram", "Uravakonda", "Kalyandurg", "Rayadurg"],
      },
      {
        name: "Sri Potti Sriramulu Nellore",
        villages: ["Nellore City", "Kavali", "Kovur", "Atmakur", "Buchireddypalem", "Allur", "Indukurpet", "Venkatachalam"],
      },
      {
        name: "YSR Kadapa",
        villages: ["Kadapa City", "Proddatur", "Pulivendula", "Jammalamadugu", "Badvel", "Mydukur", "Rayachoti Road", "Vempalli"],
      },
      {
        name: "East Godavari",
        villages: ["Rajahmundry City", "Kovvur", "Nidadavole", "Devarapalli", "Gopalapuram", "Anaparthi", "Korukonda"],
      },
      {
        name: "Kakinada",
        villages: ["Kakinada City", "Samalkota", "Pithapuram", "Peddapuram", "Tuni", "Prathipadu", "Karapa", "Thallarevu"],
      },
      {
        name: "Dr. B.R. Ambedkar Konaseema",
        villages: ["Amalapuram", "Razole", "Ravulapalem", "Kothapeta", "Mandapeta", "Mummidivaram", "Ramachandrapuram"],
      },
      {
        name: "West Godavari",
        villages: ["Bhimavaram", "Tadepalligudem", "Tanuku", "Palakollu", "Narasapuram", "Akividu", "Achanta"],
      },
      {
        name: "Eluru",
        villages: ["Eluru City", "Jangareddygudem", "Chintalapudi", "Nuzvid", "Denduluru", "Bhimadole", "Kamavarapukota"],
      },
      {
        name: "Prakasam",
        villages: ["Ongole City", "Markapur", "Giddalur", "Kanigiri", "Podili", "Chirala Road", "Singarayakonda"],
      },
      {
        name: "Srikakulam",
        villages: ["Srikakulam Town", "Amadalavalasa", "Palasa", "Tekkali", "Narasannapeta", "Ichchapuram", "Sompeta"],
      },
      {
        name: "Vizianagaram",
        villages: ["Vizianagaram City", "Bobbili", "Parvathipuram Road", "Cheepurupalli", "Gajapathinagaram", "Srungavarapukota"],
      },
      {
        name: "Chittoor",
        villages: ["Chittoor Town", "Palamaner", "Kuppam", "Punganur", "Nagari", "Bangarupalem", "Penumuru"],
      },
      {
        name: "Nandyal",
        villages: ["Nandyal Town", "Allagadda", "Banaganapalle", "Dhone", "Nandikotkur", "Srisailam", "Atmakur"],
      },
      {
        name: "Sri Sathya Sai",
        villages: ["Puttaparthi", "Kadiri", "Hindupur", "Dharmavaram", "Madakasira", "Penukonda", "Gorantla"],
      },
      {
        name: "Annamayya",
        villages: ["Rayachoti", "Madanapalle", "Rajampet", "Railway Koduru", "Pileru", "Valmikipuram", "Gurramkonda"],
      },
      {
        name: "Bapatla",
        villages: ["Bapatla Town", "Chirala", "Repalle", "Vemuru", "Parchur", "Addanki", "Korisapadu"],
      },
      {
        name: "Palnadu",
        villages: ["Narasaraopet", "Sattenapalle", "Vinukonda", "Gurazala", "Macherla", "Piduguralla", "Chilakaluripet"],
      },
    ],
  },
  "Karnataka": {
    name: "Karnataka",
    districts: [
      {
        name: "Bengaluru Urban",
        villages: [
          "Indiranagar", "Koramangala", "Whitefield", "HSR Layout", "Jayanagar", "JP Nagar",
          "Electronic City", "Marathahalli", "BTM Layout", "Malleshwaram", "Rajajinagar",
          "Banashankari", "Hebbal", "Yelahanka", "Bellandur", "Sarjapur Road"
        ],
      },
      {
        name: "Bengaluru Rural",
        villages: ["Doddaballapura", "Devanahalli", "Hosakote", "Nelamangala"],
      },
      {
        name: "Mysuru",
        villages: ["Mysuru City", "Nanjangud", "Hunsur", "T. Narasipura", "K.R. Nagar", "Periyapatna"],
      },
      {
        name: "Dakshina Kannada (Mangaluru)",
        villages: ["Mangaluru City", "Bantwal", "Puttur", "Belthangady", "Sullia", "Moodbidri"],
      },
      {
        name: "Belagavi",
        villages: ["Belagavi City", "Gokak", "Chikkodi", "Athani", "Bailhongal", "Saundatti"],
      },
      {
        name: "Hubballi-Dharwad",
        villages: ["Hubballi City", "Dharwad City", "Navalgund", "Kalghatgi", "Kundgol"],
      },
      {
        name: "Kalaburagi",
        villages: ["Kalaburagi City", "Sedam", "Chittapur", "Aland", "Afzalpur", "Chincholi"],
      },
      {
        name: "Udupi",
        villages: ["Udupi Town", "Manipal", "Kundapura", "Karkala", "Kaup", "Brahmavara", "Byndoor"],
      },
      {
        name: "Ballari",
        villages: ["Ballari City", "Siruguppa", "Kampli", "Sandur", "Kurugodu"],
      },
      {
        name: "Shimoga",
        villages: ["Shivamogga City", "Bhadravathi", "Sagar", "Shikaripura", "Soraba", "Thirthahalli"],
      },
    ],
  },
  "Maharashtra": {
    name: "Maharashtra",
    districts: [
      {
        name: "Mumbai Suburban",
        villages: [
          "Andheri", "Bandra", "Borivali", "Juhu", "Malad", "Goregaon", "Powai", "Kurla",
          "Chembur", "Ghatkopar", "Mulund", "Kandivali", "Santacruz", "Vile Parle"
        ],
      },
      {
        name: "Mumbai City",
        villages: ["Colaba", "Dadar", "Nariman Point", "Fort", "Byculla", "Parel", "Worli", "Girgaon", "Marine Lines"],
      },
      {
        name: "Pune",
        villages: [
          "Shivajinagar", "Kothrud", "Hinjawadi", "Hadapsar", "Viman Nagar", "Kalyani Nagar",
          "Baner", "Aundh", "Wakad", "Pimpri", "Chinchwad", "Kharadi", "Magarpatta"
        ],
      },
      {
        name: "Thane",
        villages: ["Thane West", "Thane East", "Kalyan", "Dombivli", "Ulhasnagar", "Bhiwandi", "Mumbra", "Mira-Bhayandar"],
      },
      {
        name: "Nagpur",
        villages: ["Nagpur City", "Sitabuldi", "Dharampeth", "Wardhaman Nagar", "Sadar", "Kamptee", "Hingna"],
      },
      {
        name: "Nashik",
        villages: ["Nashik City", "Panchavati", "CIDCO", "Satpur", "Deolali", "Malegaon", "Sinnar"],
      },
      {
        name: "Chhatrapati Sambhajinagar (Aurangabad)",
        villages: ["Aurangabad City", "CIDCO Aurangabad", "Waluj", "Cantonment", "Chikalthana", "Paithan"],
      },
    ],
  },
  "Tamil Nadu": {
    name: "Tamil Nadu",
    districts: [
      {
        name: "Chennai",
        villages: [
          "T. Nagar", "Adyar", "Anna Nagar", "Velachery", "Mylapore", "Guindy", "Tambaram",
          "Kilpauk", "Nungambakkam", "Royapettah", "Chromepet", "Porur", "Thiruvanmiyur"
        ],
      },
      {
        name: "Coimbatore",
        villages: ["RS Puram", "Gandhipuram", "Peelamedu", "Saibaba Colony", "Saravanampatti", "Singanallur", "Ukkadam"],
      },
      {
        name: "Madurai",
        villages: ["Madurai City", "Anna Nagar Madurai", "KK Nagar", "Goripalayam", "Simmakkal", "Thirunagar", "Melur"],
      },
      {
        name: "Tiruchirappalli",
        villages: ["Trichy City", "Thillai Nagar", "Srirangam", "Cantonment", "K.K. Nagar Trichy", "Ponmalai"],
      },
      {
        name: "Salem",
        villages: ["Salem City", "Hasthampatti", "Fairlands", "Suramangalam", "Ammapet", "Attur", "Mettur"],
      },
    ],
  },
  "Delhi": {
    name: "Delhi",
    districts: [
      {
        name: "New Delhi",
        villages: ["Connaught Place", "Chanakyapuri", "Barakhamba", "Gole Market", "Laxmi Bai Nagar", "Sarojini Nagar"],
      },
      {
        name: "South Delhi",
        villages: ["Hauz Khas", "Saket", "Greater Kailash", "South Extension", "Green Park", "Malviya Nagar", "Mehrauli"],
      },
      {
        name: "Central Delhi",
        villages: ["Karol Bagh", "Daryaganj", "Pahar Ganj", "Civil Lines", "Rajendra Nagar"],
      },
      {
        name: "West Delhi",
        villages: ["Rajouri Garden", "Janakpuri", "Punjabi Bagh", "Tilak Nagar", "Patel Nagar", "Paschim Vihar"],
      },
      {
        name: "North Delhi",
        villages: ["Model Town", "Rohini", "Pitampura", "Shalimar Bagh", "Alipur", "Narela"],
      },
      {
        name: "East Delhi",
        villages: ["Laxmi Nagar", "Preet Vihar", "Mayur Vihar", "Patparganj", "Karkardooma", "Vivek Vihar"],
      },
      {
        name: "South West Delhi",
        villages: ["Dwarka", "Vasant Kunj", "Vasant Vihar", "Najafgarh", "Delhi Cantt", "Mahipalpur"],
      },
    ],
  },
  "Kerala": {
    name: "Kerala",
    districts: [
      {
        name: "Ernakulam (Kochi)",
        villages: ["Kochi City", "Kakkanad", "Edappally", "Kaloor", "Aluva", "Angamaly", "Tripunithura", "Fort Kochi"],
      },
      {
        name: "Thiruvananthapuram",
        villages: ["Trivandrum City", "Kowdiar", "Pattom", "Kazhakkoottam", "Technopark", "Attingal", "Neyyattinkara"],
      },
      {
        name: "Kozhikode",
        villages: ["Kozhikode City", "Mavoor", "Feroke", "Vadakara", "Koyilandy", "Ramanattukara"],
      },
      {
        name: "Thrissur",
        villages: ["Thrissur City", "Chalakudy", "Kodungallur", "Guruvayur", "Kunnamkulam", "Irinjalakuda"],
      },
    ],
  },
  "Gujarat": {
    name: "Gujarat",
    districts: [
      {
        name: "Ahmedabad",
        villages: ["Navrangpura", "Satellite", "Bodakdev", "Vastrapur", "Maninagar", "Paldi", "Bopal", "Gota"],
      },
      {
        name: "Surat",
        villages: ["Athwa", "Adajan", "Varachha", "Katargam", "Vesu", "Udhna", "Rander", "Piplod"],
      },
      {
        name: "Vadodara",
        villages: ["Alkapuri", "Fatehgunj", "Manjalpur", "Sayajigunj", "Gotri", "Karelibaug", "Vasna"],
      },
      {
        name: "Rajkot",
        villages: ["Rajkot City", "Kalawad Road", "University Road", "Yagnik Road", "Kothariya", "Bhaktinagar"],
      },
    ],
  },
  "Uttar Pradesh": {
    name: "Uttar Pradesh",
    districts: [
      {
        name: "Lucknow",
        villages: ["Hazratganj", "Gomti Nagar", "Alambagh", "Indira Nagar", "Mahanagar", "Charbagh", "Aminabad"],
      },
      {
        name: "Kanpur",
        villages: ["Civil Lines", "Swaroop Nagar", "Kakadeo", "Kidwai Nagar", "Govind Nagar", "Kalyanpur"],
      },
      {
        name: "Varanasi",
        villages: ["Varanasi City", "Lanka", "Sigra", "Bhelupur", "Cantonment", "Godowlia", "Shivpur"],
      },
      {
        name: "Gautam Buddha Nagar (Noida)",
        villages: ["Sector 18", "Sector 62", "Sector 15", "Greater Noida", "Noida City Centre", "Sector 137"],
      },
      {
        name: "Ghaziabad",
        villages: ["Indirapuram", "Vaishali", "Vasundhara", "Raj Nagar", "Crossings Republik", "Kaushambi"],
      },
    ],
  },
  "West Bengal": {
    name: "West Bengal",
    districts: [
      {
        name: "Kolkata",
        villages: ["Salt Lake", "New Town", "Park Street", "Ballygunge", "Alipore", "Dum Dum", "Behala", "Gariahat"],
      },
      {
        name: "Howrah",
        villages: ["Howrah City", "Shibpur", "Salkia", "Liluah", "Bally", "Uluberia"],
      },
    ],
  },
  "Rajasthan": {
    name: "Rajasthan",
    districts: [
      {
        name: "Jaipur",
        villages: ["Malviya Nagar", "Vaishali Nagar", "C-Scheme", "Mansarovar", "Raja Park", "Tonk Road"],
      },
      {
        name: "Jodhpur",
        villages: ["Jodhpur City", "Shastri Nagar", "Ratanada", "Sardarpura", "Paota"],
      },
      {
        name: "Udaipur",
        villages: ["Udaipur City", "Fatehpura", "Hiran Magri", "Panchwati", "Sukhadia Circle"],
      },
    ],
  },
  "Madhya Pradesh": {
    name: "Madhya Pradesh",
    districts: [
      {
        name: "Indore",
        villages: ["Vijay Nagar", "Palasia", "MG Road", "Sapna Sangeeta", "Bhawarkua", "Annapurna Road"],
      },
      {
        name: "Bhopal",
        villages: ["Arera Colony", "MP Nagar", "New Market", "Kolar Road", "Hoshangabad Road", "Shahpura"],
      },
    ],
  },
  "Punjab": {
    name: "Punjab",
    districts: [
      {
        name: "Ludhiana",
        villages: ["Model Town", "Civil Lines", "Sarabha Nagar", "BRS Nagar", "Ferozepur Road"],
      },
      {
        name: "Amritsar",
        villages: ["Amritsar City", "Ranjit Avenue", "Mall Road", "Lawrence Road", "Majitha Road"],
      },
    ],
  },
  "Haryana": {
    name: "Haryana",
    districts: [
      {
        name: "Gurugram",
        villages: ["DLF Phase 1-5", "Cyber City", "Sohna Road", "Golf Course Road", "Sector 14", "Sector 29"],
      },
      {
        name: "Faridabad",
        villages: ["Sector 15", "NIT Faridabad", "Sector 16", "Greenfield", "Badkhal"],
      },
    ],
  },
  "Bihar": {
    name: "Bihar",
    districts: [
      {
        name: "Patna",
        villages: ["Boring Road", "Kankarbagh", "Bailey Road", "Fraser Road", "Rajendra Nagar", "Danapur"],
      },
    ],
  },
  "Odisha": {
    name: "Odisha",
    districts: [
      {
        name: "Khordha (Bhubaneswar)",
        villages: ["Saheed Nagar", "Nayapalli", "Jayadev Vihar", "Khandagiri", "Chandrasekharpur", "Patia"],
      },
      {
        name: "Cuttack",
        villages: ["Cuttack City", "Badambadi", "CDA Sector", "Mangalabag", "Buxi Bazaar"],
      },
    ],
  },
  "Assam": {
    name: "Assam",
    districts: [
      {
        name: "Kamrup Metropolitan (Guwahati)",
        villages: ["GS Road", "Paltan Bazaar", "Dispur", "Ulubari", "Ganeshguri", "Six Mile", "Pan Bazaar"],
      },
    ],
  },
  "Goa": {
    name: "Goa",
    districts: [
      {
        name: "North Goa",
        villages: ["Panaji", "Mapusa", "Calangute", "Candolim", "Porvorim", "Old Goa"],
      },
      {
        name: "South Goa",
        villages: ["Margao", "Vasco da Gama", "Ponda", "Colva", "Benaulim"],
      },
    ],
  },
};

// Default fallback list of states for any country or general state selection
export const ALL_INDIAN_STATES = Object.keys(INDIA_STATES);
