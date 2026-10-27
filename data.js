"use strict";
/* ---------------- Static data ---------------- */
const STATES = {AL:"Alabama",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"};
const CITY_RAW = [
["Birmingham","AL",33.52,-86.80,1],["Montgomery","AL",32.37,-86.30],["Mobile","AL",30.69,-88.04],["Huntsville","AL",34.73,-86.59],
["Phoenix","AZ",33.45,-112.07,1],["Tucson","AZ",32.22,-110.97],["Flagstaff","AZ",35.20,-111.65],
["Little Rock","AR",34.75,-92.29],["Fort Smith","AR",35.39,-94.40],
["Los Angeles","CA",34.05,-118.24,1],["San Francisco","CA",37.77,-122.42,1],["San Diego","CA",32.72,-117.16],["Sacramento","CA",38.58,-121.49],["Fresno","CA",36.74,-119.79],["Bakersfield","CA",35.37,-119.02],
["Denver","CO",39.74,-104.99,1],["Colorado Springs","CO",38.83,-104.82],["Grand Junction","CO",39.06,-108.55],
["Hartford","CT",41.76,-72.67],["Wilmington","DE",39.74,-75.55],
["Jacksonville","FL",30.33,-81.66,1],["Miami","FL",25.76,-80.19,1],["Tampa","FL",27.95,-82.46],["Orlando","FL",28.54,-81.38],["Tallahassee","FL",30.44,-84.28],
["Atlanta","GA",33.75,-84.39,1],["Savannah","GA",32.08,-81.09],["Macon","GA",32.84,-83.63],["Augusta","GA",33.47,-81.97],["Columbus","GA",32.46,-84.99],["Athens","GA",33.96,-83.38],["Valdosta","GA",30.83,-83.28],["Conyers","GA",33.67,-84.02],
["Boise","ID",43.62,-116.20],["Idaho Falls","ID",43.49,-112.03],
["Chicago","IL",41.88,-87.63,1],["Springfield","IL",39.80,-89.64],["Peoria","IL",40.69,-89.59],
["Indianapolis","IN",39.77,-86.16,1],["Fort Wayne","IN",41.08,-85.14],
["Des Moines","IA",41.59,-93.62],["Cedar Rapids","IA",41.98,-91.67],
["Wichita","KS",37.69,-97.34],["Topeka","KS",39.05,-95.68],
["Louisville","KY",38.25,-85.76],["Lexington","KY",38.04,-84.50],
["New Orleans","LA",29.95,-90.07,1],["Baton Rouge","LA",30.45,-91.15],["Shreveport","LA",32.53,-93.75],
["Portland","ME",43.66,-70.26],["Bangor","ME",44.80,-68.77],
["Baltimore","MD",39.29,-76.61],["Boston","MA",42.36,-71.06,1],["Springfield","MA",42.10,-72.59],
["Detroit","MI",42.33,-83.05,1],["Grand Rapids","MI",42.96,-85.67],["Lansing","MI",42.73,-84.56],
["Minneapolis","MN",44.98,-93.27,1],["Duluth","MN",46.79,-92.10],
["Jackson","MS",32.30,-90.18],["Gulfport","MS",30.37,-89.09],
["Kansas City","MO",39.10,-94.58,1],["St. Louis","MO",38.63,-90.20,1],["Springfield","MO",37.21,-93.29],
["Billings","MT",45.78,-108.50],["Missoula","MT",46.87,-113.99],
["Omaha","NE",41.26,-95.93],["Lincoln","NE",40.81,-96.70],["North Platte","NE",41.12,-100.77],
["Las Vegas","NV",36.17,-115.14,1],["Reno","NV",39.53,-119.81],
["Manchester","NH",42.99,-71.46],["Newark","NJ",40.74,-74.17],["Trenton","NJ",40.22,-74.76],
["Albuquerque","NM",35.08,-106.65],["Las Cruces","NM",32.32,-106.76],
["New York","NY",40.71,-74.01,1],["Buffalo","NY",42.89,-78.88],["Albany","NY",42.65,-73.75],["Syracuse","NY",43.05,-76.15],
["Charlotte","NC",35.23,-80.84,1],["Raleigh","NC",35.78,-78.64],["Greensboro","NC",36.07,-79.79],["Asheville","NC",35.60,-82.55],
["Fargo","ND",46.88,-96.79],["Bismarck","ND",46.81,-100.78],
["Columbus","OH",39.96,-83.00,1],["Cleveland","OH",41.50,-81.69],["Cincinnati","OH",39.10,-84.51],["Toledo","OH",41.65,-83.54],
["Oklahoma City","OK",35.47,-97.52],["Tulsa","OK",36.15,-95.99],
["Portland","OR",45.52,-122.68,1],["Eugene","OR",44.05,-123.09],["Medford","OR",42.33,-122.87],
["Philadelphia","PA",39.95,-75.17,1],["Pittsburgh","PA",40.44,-79.99],["Harrisburg","PA",40.27,-76.88],["Allentown","PA",40.60,-75.49],
["Providence","RI",41.82,-71.41],
["Columbia","SC",34.00,-81.03],["Charleston","SC",32.78,-79.93],["Greenville","SC",34.85,-82.40],
["Sioux Falls","SD",43.55,-96.73],["Rapid City","SD",44.08,-103.23],
["Nashville","TN",36.16,-86.78,1],["Memphis","TN",35.15,-90.05,1],["Knoxville","TN",35.96,-83.92],["Chattanooga","TN",35.05,-85.31],
["Dallas","TX",32.78,-96.80,1],["Houston","TX",29.76,-95.37,1],["San Antonio","TX",29.42,-98.49],["Austin","TX",30.27,-97.74],["El Paso","TX",31.76,-106.49],["Amarillo","TX",35.22,-101.83],["Laredo","TX",27.51,-99.51],["Lubbock","TX",33.58,-101.86],
["Salt Lake City","UT",40.76,-111.89,1],["St. George","UT",37.10,-113.58],
["Burlington","VT",44.48,-73.21],
["Richmond","VA",37.54,-77.44],["Norfolk","VA",36.85,-76.29],["Roanoke","VA",37.27,-79.94],
["Seattle","WA",47.61,-122.33,1],["Spokane","WA",47.66,-117.43],["Yakima","WA",46.60,-120.51],
["Charleston","WV",38.35,-81.63],
["Milwaukee","WI",43.04,-87.91],["Madison","WI",43.07,-89.40],["Green Bay","WI",44.51,-88.02],
["Cheyenne","WY",41.14,-104.82],["Casper","WY",42.87,-106.31]
];
const CITIES = CITY_RAW.map((c,i)=>({i,n:c[0],s:c[1],lat:c[2],lon:c[3],m:!!c[4]}));

const CARGO = {
  general:{n:"General freight",mult:1.0}, parcels:{n:"Parcels",mult:1.1}, furniture:{n:"Furniture",mult:1.1},
  pallets:{n:"Pallets",mult:1.0}, refrigerated:{n:"Refrigerated",mult:1.4}, lumber:{n:"Lumber",mult:1.2},
  steel:{n:"Steel",mult:1.2}, machinery:{n:"Machinery",mult:1.3}, liquids:{n:"Liquids",mult:1.2},
  hazmat:{n:"Hazmat fuel",mult:1.8}, vehicles:{n:"Vehicles",mult:1.5},
  grain:{n:"Grain",mult:0.8}, coal:{n:"Coal",mult:0.7}, gravel:{n:"Gravel",mult:0.7}, containers:{n:"Containers",mult:1.0}
};
const PRODUCERS = {general:["Warehouse","Factory","Distribution Center"],parcels:["Parcel Hub","Warehouse"],furniture:["Furniture Maker"],pallets:["Bottling Plant","Paper Mill","Factory"],refrigerated:["Farm","Food Processor","Dairy"],lumber:["Lumber Yard","Sawmill"],steel:["Steel Mill"],machinery:["Machine Shop","Equipment Factory"],liquids:["Chemical Plant","Water Bottler"],hazmat:["Refinery"],vehicles:["Auto Plant","Vehicle Port"]};
const ACCEPTORS = {general:["Retail Store","Grocery Distribution Center","Hardware Store"],parcels:["Retail Store","Hospital","Office Park"],furniture:["Furniture Store","Hotel"],pallets:["Grocery Distribution Center","Big-Box Store","Warehouse"],refrigerated:["Grocery Distribution Center","Restaurant Supplier","Hospital"],lumber:["Construction Site","Hardware Store"],steel:["Construction Site","Manufacturing Plant"],machinery:["Construction Site","Manufacturing Plant","Farm"],liquids:["Manufacturing Plant","Water Treatment Plant"],hazmat:["Fuel Depot","Airport Fuel Farm"],vehicles:["Car Dealership"]};

const TYPES = [
  {id:"van",n:"Cargo van",price:8000,cap:3000,leg:300,cargo:["general","parcels"],lic:"std",lvl:1,big:false},
  {id:"box",n:"Box truck",price:45000,cap:10000,leg:400,cargo:["general","parcels","furniture"],lic:"std",lvl:2,big:false},
  {id:"reeferbox",n:"Reefer box truck",price:70000,cap:9000,leg:400,cargo:["refrigerated"],lic:"std",lvl:5,big:false},
  {id:"straight",n:"Straight truck (26 ft)",price:90000,cap:18000,leg:600,cargo:["general","pallets"],lic:"cdl",lvl:6,big:true},
  {id:"semidry",n:"Semi + dry van",price:150000,cap:45000,leg:1200,cargo:["general","pallets"],lic:"cdl",lvl:10,big:true},
  {id:"semireefer",n:"Semi + reefer",price:185000,cap:42000,leg:1200,cargo:["refrigerated"],lic:"cdl",lvl:12,big:true},
  {id:"flatbed",n:"Semi + flatbed",price:170000,cap:48000,leg:1000,cargo:["lumber","steel","machinery"],lic:"cdl",lvl:14,big:true},
  {id:"tanker",n:"Semi + tanker",price:210000,cap:40000,leg:1000,cargo:["liquids","hazmat"],lic:"cdl",lvl:18,big:true},
  {id:"carhauler",n:"Semi + car hauler",price:200000,cap:9,leg:1200,cargo:["vehicles"],lic:"cdl",lvl:20,big:true,cars:true},
  {id:"team",n:"Team-driven semi",price:240000,cap:45000,leg:2800,cargo:["general","pallets"],lic:"cdl2",lvl:25,big:true}
];
const TYPE = Object.fromEntries(TYPES.map(t=>[t.id,t]));
const DRIVER_KIND = {
  owner:{n:"Owner",cut:0}, std:{n:"Driver",cut:0,fee:1000,lvl:1}, cdl:{n:"CDL driver",cut:0,fee:5000,lvl:6}
};
const FIRST = ["Marcus","Dana","Luis","Keisha","Travis","Rosa","Dwayne","Megan","Andre","Tasha","Cody","Imani","Hector","Brianna","Jamal","Lena","Wyatt","Carmen","Darnell","Shelby","Omar","Kayla","Reggie","Nina"];
const LAST = ["Brooks","Ortiz","Hale","Washington","Price","Nguyen","Carter","Reyes","Mills","Jenkins","Parker","Diaz","Cole","Bishop","Foster","Ramos","Banks","Lowe","Grant","Avery"];
const DRV_LEVELS = [0,5,15,30,50];
const GARAGE_PRICE = 40000, GARAGE_LVL = 1, SLOT_PRICE = 15000, DISPATCH_PRICE = 15000, DISPATCH_LVL = 8, HAZMAT_PRICE = 10000;
const RADIUS_MI = 150, MAX_DEADHEAD = 300, BOARD_PER_BASE = 10, MIN = 60000;
const UNLOCKS = {2:"Box truck",5:"Reefer box truck",6:"CDL drivers and straight truck",8:"Dispatchers",10:"Semi + dry van",12:"Semi + reefer",14:"Semi + flatbed",15:"Trains, rail yards and engineers",18:"Tankers and hazmat training",20:"Road freight locomotive, car haulers, air cargo (next build)",25:"Team-driven semi"};


/* Hub sizes: every garage starts Small and can be upgraded. */
const HUB_TIERS = [
  {n:"Small hub",  cap:20, price:0,      lvl:1},
  {n:"Medium hub", cap:40, price:75000,  lvl:4},
  {n:"Large hub",  cap:60, price:200000, lvl:10}
];
const JOB_BOARD_MAX = 25;     // most jobs a board (truck, train or air) holds at once
const JOB_EVERY_MS = 60000;   // a new job posts every minute on each board while it has room

/* Made-up business names: a place word + a suffix that fits the business type. */
const NAME_WORDS = ["Magnolia","Cedar Ridge","Blue Heron","Ironwood","Riverbend","Red Clay","Pine Hollow","Silver Creek","Oak Bluff","Stonegate","Harborview","Copper Hill","Willow Bend","Granite Peak","Sunfield","Eagle Rock","Bramblewood","Prairie Wind","Lakeshore","Foxglove","Summit Point","Briarwood","Northstar","Hickory Lane","Juniper","Bayou","Cottonwood","Tall Pine","Golden Field","Sweetwater","Thunder Ridge","Peach Blossom","Lone Oak","Crescent","Bluestone","Sandhill","Wildflower","Ridgeline","Old Mill","Harvest Moon"];
const NAME_SUFFIX = {
  "Warehouse":["Storage & Logistics","Warehousing","Distribution Co."],
  "Factory":["Manufacturing","Industries","Works"],
  "Distribution Center":["Distribution Center","Supply Hub"],
  "Parcel Hub":["Parcel Center","Courier Hub","Express Sort"],
  "Furniture Maker":["Furniture Co.","Woodcraft","Home Furnishings"],
  "Bottling Plant":["Bottling Co.","Beverage Works"],
  "Paper Mill":["Paper Mill","Paper & Pulp"],
  "Farm":["Farms","Family Farm","Orchards","Produce Co."],
  "Food Processor":["Foods","Fresh Foods","Packing Co."],
  "Dairy":["Dairy","Creamery"],
  "Lumber Yard":["Lumber Co.","Timber Supply"],
  "Sawmill":["Sawmill","Timber Mill"],
  "Steel Mill":["Steel","Steel Works","Metals"],
  "Machine Shop":["Machine & Tool","Machine Works"],
  "Equipment Factory":["Equipment","Heavy Equipment Co."],
  "Chemical Plant":["Chemical","Chemical Works"],
  "Water Bottler":["Spring Water Co.","Water Co."],
  "Refinery":["Refining","Energy"],
  "Auto Plant":["Motor Assembly","Auto Works"],
  "Vehicle Port":["Vehicle Port","Auto Terminal"],
  "Retail Store":["Outfitters","General Store","Market"],
  "Grocery Distribution Center":["Grocery Distribution","Fresh Market DC"],
  "Hardware Store":["Hardware","Home & Hardware","Building Supply"],
  "Hospital":["Regional Medical Center","General Hospital","Medical Center"],
  "Office Park":["Office Park","Business Center"],
  "Furniture Store":["Furniture Gallery","Home Store"],
  "Hotel":["Inn & Suites","Grand Hotel","Lodge"],
  "Big-Box Store":["Supercenter","Mega Mart"],
  "Restaurant Supplier":["Restaurant Supply","Food Service"],
  "Construction Site":["Tower (construction)","Apartments (construction)","Commons (construction)"],
  "Manufacturing Plant":["Manufacturing","Fabrication"],
  "Water Treatment Plant":["Water Treatment Plant","Water Works"],
  "Fuel Depot":["Fuel Depot","Fuel Terminal"],
  "Airport Fuel Farm":["Airfield Fuel Farm"],
  "Car Dealership":["Motors","Auto Sales","Auto Mall"]
};
const FALLBACK_STREETS = ["Industrial Blvd","Commerce Pkwy","Logistics Dr","Depot St","Enterprise Way","Freight Ln"];

/* Map and list icons per kind of vehicle (Material Design icon shapes, Apache 2.0). */
const VEHICLE_ICONS = {
  truck: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm13.5-9 1.96 2.5H17V9.5h2.5zm-1.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z",
  train: "M12 2c-4 0-8 .5-8 4v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z",
  plane: "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z",
  bus:   "M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm1.5-6H6V6h12v5z"
};
// Every vehicle type in the game today is a truck; trains, planes and buses use the same table when they arrive.
TYPES.forEach(t => { t.mode = t.mode || "truck"; });
const iconSvg = (mode, size=14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${VEHICLE_ICONS[mode]||VEHICLE_ICONS.truck}"/></svg>`;

/* Timing (original fast pace).
   Driving: 1 minute + 1 minute per 30 road miles; to-pickup and the trip home run at double speed.
   Loading and unloading take longer the heavier the load. */
const PAY_SCALE = 1;
const LOAD_BASE_MIN = 0.5;           // dock check-in and paperwork
const LOAD_MIN_PER_1000LB = 0.1;     // 3,000 lb ≈ 48 s, 10,000 lb ≈ 1.5 min, 45,000 lb ≈ 5 min
const LOAD_MIN_PER_CAR = 0.5;        // car haulers, per vehicle
TYPES.forEach(t => { t.slow = 1; });


/* ---------------- Rail ----------------
   Real US freight rail yards (positions from OpenStreetMap). Trains run between them on real track. */
const RAIL_YARDS = [
  ["bailey","Bailey Yard","North Platte","NE",41.1495,-100.8314],
  ["clearing","Clearing Yard","Bedford Park","IL",41.7680,-87.7600],
  ["proviso","Proviso Yard","Northlake","IL",41.8987,-87.9046],
  ["corwith","Corwith Yard","Chicago","IL",41.8170,-87.7117],
  ["argentine","Argentine Yard","Kansas City","KS",39.0809,-94.6770],
  ["northtown","Northtown Yard","Fridley","MN",45.0430,-93.2730],
  ["roseville","Roseville Yard","Roseville","CA",38.7285,-121.3088],
  ["barstow","Barstow Yard","Barstow","CA",34.8935,-117.0712],
  ["hobart","Hobart Yard","Los Angeles","CA",34.0070,-118.1864],
  ["roper","Roper Yard","Salt Lake City","UT",40.7149,-111.9102],
  ["belen","Belen Yard","Belen","NM",34.6499,-106.7686],
  ["hinkle","Hinkle Yard","Hermiston","OR",45.7936,-119.2586],
  ["pasco","Pasco Yard","Pasco","WA",46.2648,-119.0989],
  ["balmer","Balmer Yard","Seattle","WA",47.6442,-122.3811],
  ["brooklyn","Brooklyn Yard","Portland","OR",45.4901,-122.6450],
  ["yardley","Yardley Yard","Spokane","WA",47.6702,-117.3381],
  ["rennick","Rennick Yard","Denver","CO",39.7769,-104.9973],
  ["englewood","Englewood Yard","Houston","TX",29.7949,-95.2947],
  ["alliance","Alliance Intermodal Yard","Fort Worth","TX",33.0046,-97.3490],
  ["avondale","Avondale Yard","New Orleans","LA",29.9181,-90.1830],
  ["radnor","Radnor Yard","Nashville","TN",36.0915,-86.7560],
  ["inman","Inman Yard","Atlanta","GA",33.7968,-84.4456],
  ["norris","Norris Yard","Birmingham","AL",33.5574,-86.6858],
  ["rice","Rice Yard","Waycross","GA",31.1824,-82.3911],
  ["moncrief","Moncrief Yard","Jacksonville","FL",30.3483,-81.7037],
  ["winston","Winston Yard","Lakeland","FL",28.0106,-81.9960],
  ["acca","Acca Yard","Richmond","VA",37.5849,-77.4776],
  ["enola","Enola Yard","Harrisburg","PA",40.2942,-76.9272],
  ["conway","Conway Yard","Pittsburgh","PA",40.6643,-80.2450],
  ["selkirk","Selkirk Yard","Albany","NY",42.5536,-73.8375],
  ["oakisland","Oak Island Yard","Newark","NJ",40.7058,-74.1342],
  ["buckeye","Buckeye Yard","Columbus","OH",39.9893,-83.1304],
  ["queensgate","Queensgate Yard","Cincinnati","OH",39.1260,-84.5397],
  ["avon","Avon Yard","Indianapolis","IN",39.7573,-86.3647],
  ["madison","Madison Yard","Madison","IL",38.6794,-90.1438],
  ["frontier","Frontier Yard","Buffalo","NY",42.9013,-78.8004],
  ["cherokee","Cherokee Yard","Tulsa","OK",36.1216,-96.0114],
  ["livernois","Livernois Yard","Detroit","MI",42.3199,-83.1200]
].map(([id,n,city,s,lat,lon])=>({id,n,city,s,lat,lon}));
const YARD = Object.fromEntries(RAIL_YARDS.map(y=>[y.id,y]));
const RAIL_LVL = 15;
const RAIL_PAY = 0.5;            // rail pays less per pound-mile, but trains carry a lot
const CONTAINER_LB = 40000;
const MAX_RAIL_DEADHEAD = 600;   // a train can run empty this far to reach a pickup yard
const ENGINEER = {n:"Engineer", fee:20000, lvl:RAIL_LVL};
const RAILCARS = {
  box:    {n:"Boxcar",            price:60000, cap:120000, cargo:["general","pallets"]},
  hopper: {n:"Covered hopper",    price:65000, cap:200000, cargo:["grain"]},
  open:   {n:"Open hopper",       price:55000, cap:200000, cargo:["coal","gravel"]},
  tank:   {n:"Tank car",          price:90000, cap:180000, cargo:["liquids"]},
  reefer: {n:"Reefer car",        price:95000, cap:100000, cargo:["refrigerated"]},
  flat:   {n:"Flatcar",           price:50000, cap:150000, cargo:["lumber","steel","machinery"]},
  well:   {n:"Container well car",price:70000, cap:2, perUnit:CONTAINER_LB, cargo:["containers"], unit:"container"}
};
const LOCOS = [
  {id:"switcher",  n:"Switcher locomotive",      price:400000,  maxCars:8,  leg:400,  lvl:15, mode:"train", lic:"eng"},
  {id:"roadloco",  n:"Road freight locomotive",  price:1200000, maxCars:25, leg:1500, lvl:20, mode:"train", lic:"eng"},
  {id:"heavyloco", n:"Heavy-haul locomotive",    price:2800000, maxCars:60, leg:3000, lvl:30, mode:"train", lic:"eng"}
];
LOCOS.forEach(l=>{ TYPE[l.id] = l; });
DRIVER_KIND.eng = {n:"Engineer", cut:0, fee:ENGINEER.fee, lvl:RAIL_LVL};
Object.assign(PRODUCERS, {grain:["Grain Elevator"], coal:["Coal Mine"], gravel:["Quarry"]});
Object.assign(ACCEPTORS, {grain:["Flour Mill"], coal:["Power Plant"], gravel:["Concrete Plant"]});

/* ---------------- Air cargo ----------------
   Real US airports. size: 1 regional, 2 mid-size, 3 major cargo hub. Bigger aircraft need bigger airports. */
const AIRPORTS = [
  ["MEM","Memphis International","Memphis","TN",35.0424,-89.9767,3],
  ["SDF","Louisville Muhammad Ali International","Louisville","KY",38.1744,-85.7360,3],
  ["ORD","O'Hare International","Chicago","IL",41.9786,-87.9048,3],
  ["LAX","Los Angeles International","Los Angeles","CA",33.9425,-118.4081,3],
  ["MIA","Miami International","Miami","FL",25.7959,-80.2870,3],
  ["DFW","Dallas Fort Worth International","Dallas","TX",32.8998,-97.0403,3],
  ["JFK","John F. Kennedy International","New York","NY",40.6413,-73.7781,3],
  ["ATL","Hartsfield-Jackson Atlanta International","Atlanta","GA",33.6407,-84.4277,3],
  ["CVG","Cincinnati Northern Kentucky International","Cincinnati","OH",39.0533,-84.6630,3],
  ["IND","Indianapolis International","Indianapolis","IN",39.7173,-86.2944,3],
  ["ONT","Ontario International","Ontario","CA",34.0560,-117.6012,3],
  ["EWR","Newark Liberty International","Newark","NJ",40.6895,-74.1745,3],
  ["SEA","Seattle-Tacoma International","Seattle","WA",47.4502,-122.3088,3],
  ["IAH","George Bush Intercontinental","Houston","TX",29.9902,-95.3368,3],
  ["OAK","Oakland International","Oakland","CA",37.7126,-122.2197,3],
  ["PHL","Philadelphia International","Philadelphia","PA",39.8744,-75.2424,3],
  ["DEN","Denver International","Denver","CO",39.8561,-104.6737,3],
  ["PHX","Phoenix Sky Harbor International","Phoenix","AZ",33.4342,-112.0116,3],
  ["MSP","Minneapolis-Saint Paul International","Minneapolis","MN",44.8848,-93.2223,2],
  ["DTW","Detroit Metropolitan","Detroit","MI",42.2162,-83.3554,2],
  ["BOS","Logan International","Boston","MA",42.3656,-71.0096,2],
  ["CLT","Charlotte Douglas International","Charlotte","NC",35.2140,-80.9431,2],
  ["MCO","Orlando International","Orlando","FL",28.4312,-81.3081,2],
  ["TPA","Tampa International","Tampa","FL",27.9755,-82.5332,2],
  ["BNA","Nashville International","Nashville","TN",36.1263,-86.6774,2],
  ["STL","St. Louis Lambert International","St. Louis","MO",38.7487,-90.3700,2],
  ["MCI","Kansas City International","Kansas City","MO",39.2976,-94.7139,2],
  ["SLC","Salt Lake City International","Salt Lake City","UT",40.7899,-111.9791,2],
  ["LAS","Harry Reid International","Las Vegas","NV",36.0840,-115.1537,2],
  ["PDX","Portland International","Portland","OR",45.5898,-122.5951,2],
  ["SAT","San Antonio International","San Antonio","TX",29.5337,-98.4698,2],
  ["AUS","Austin-Bergstrom International","Austin","TX",30.1975,-97.6664,2],
  ["CLE","Cleveland Hopkins International","Cleveland","OH",41.4058,-81.8539,2],
  ["CMH","John Glenn Columbus International","Columbus","OH",39.9980,-82.8919,2],
  ["PIT","Pittsburgh International","Pittsburgh","PA",40.4915,-80.2329,2],
  ["RDU","Raleigh-Durham International","Raleigh","NC",35.8801,-78.7880,2],
  ["BWI","Baltimore/Washington International","Baltimore","MD",39.1754,-76.6683,2],
  ["IAD","Washington Dulles International","Dulles","VA",38.9531,-77.4565,2],
  ["MSY","Louis Armstrong New Orleans International","New Orleans","LA",29.9934,-90.2580,2],
  ["OKC","Will Rogers World","Oklahoma City","OK",35.3931,-97.6007,2],
  ["ABQ","Albuquerque International Sunport","Albuquerque","NM",35.0402,-106.6091,2],
  ["OMA","Eppley Airfield","Omaha","NE",41.3032,-95.8941,2],
  ["ELP","El Paso International","El Paso","TX",31.8072,-106.3776,2],
  ["JAX","Jacksonville International","Jacksonville","FL",30.4941,-81.6879,2],
  ["RFD","Chicago Rockford International","Rockford","IL",42.1954,-89.0972,2],
  ["AFW","Fort Worth Alliance","Fort Worth","TX",32.9876,-97.3188,2],
  ["BOI","Boise Airport","Boise","ID",43.5644,-116.2228,1],
  ["BIL","Billings Logan International","Billings","MT",45.8077,-108.5429,1],
  ["FAR","Hector International","Fargo","ND",46.9207,-96.8158,1],
  ["FSD","Sioux Falls Regional","Sioux Falls","SD",43.5820,-96.7419,1],
  ["DSM","Des Moines International","Des Moines","IA",41.5340,-93.6631,1],
  ["ICT","Wichita Eisenhower National","Wichita","KS",37.6499,-97.4331,1],
  ["LIT","Clinton National","Little Rock","AR",34.7294,-92.2243,1],
  ["JAN","Jackson-Medgar Wiley Evers International","Jackson","MS",32.3112,-90.0759,1],
  ["BHM","Birmingham-Shuttlesworth International","Birmingham","AL",33.5629,-86.7535,1],
  ["SAV","Savannah/Hilton Head International","Savannah","GA",32.1276,-81.2021,1],
  ["CHS","Charleston International","Charleston","SC",32.8986,-80.0405,1],
  ["RIC","Richmond International","Richmond","VA",37.5052,-77.3197,1],
  ["BDL","Bradley International","Hartford","CT",41.9389,-72.6832,1],
  ["PWM","Portland International Jetport","Portland","ME",43.6462,-70.3093,1],
  ["BTV","Burlington International","Burlington","VT",44.4720,-73.1533,1],
  ["MHT","Manchester-Boston Regional","Manchester","NH",42.9326,-71.4357,1],
  ["ALB","Albany International","Albany","NY",42.7483,-73.8017,1],
  ["BUF","Buffalo Niagara International","Buffalo","NY",42.9405,-78.7322,1],
  ["MKE","Milwaukee Mitchell International","Milwaukee","WI",42.9472,-87.8966,1],
  ["GRR","Gerald R. Ford International","Grand Rapids","MI",42.8808,-85.5228,1],
  ["CYS","Cheyenne Regional","Cheyenne","WY",41.1557,-104.8118,1],
  ["RNO","Reno-Tahoe International","Reno","NV",39.4991,-119.7681,1],
  ["TUS","Tucson International","Tucson","AZ",32.1161,-110.9410,1],
  ["GEG","Spokane International","Spokane","WA",47.6199,-117.5338,1],
  ["LBB","Lubbock Preston Smith International","Lubbock","TX",33.6636,-101.8228,1],
  ["CRW","Yeager Airport","Charleston","WV",38.3731,-81.5932,1],
  ["ILG","Wilmington Airport","Wilmington","DE",39.6787,-75.6065,1],
  ["PVD","Rhode Island T. F. Green International","Providence","RI",41.7240,-71.4282,1]
].map(([id,n,city,s,lat,lon,size])=>({id,n,city,s,lat,lon,size}));
const AIRPORT = Object.fromEntries(AIRPORTS.map(a=>[a.id,a]));
const AIR_LVL = 20;
const AIR_PAY = 3;               // air pays more per pound-mile than trucks
const MAX_AIR_DEADHEAD = 1200;   // a plane can fly empty this far to reach a pickup airport
const PILOT = {n:"Pilot", fee:25000, lvl:AIR_LVL};
const AIRPORT_SIZE = {1:"Regional", 2:"Mid-size", 3:"Major cargo hub"};
const PLANES = [
  {id:"prop",      n:"Courier prop plane",     price:450000,   cap:3000,   leg:900,  lvl:20, minSize:1, lic:"pilot"},
  {id:"turboprop", n:"Turboprop freighter",    price:1500000,  cap:12000,  leg:1200, lvl:24, minSize:1, lic:"pilot"},
  {id:"rjet",      n:"Regional jet freighter", price:6000000,  cap:25000,  leg:1800, lvl:30, minSize:2, lic:"pilot2"},
  {id:"narrow",    n:"Narrowbody freighter",   price:18000000, cap:50000,  leg:3000, lvl:38, minSize:2, lic:"pilot2"},
  {id:"wide",      n:"Widebody freighter",     price:60000000, cap:220000, leg:4500, lvl:50, minSize:3, lic:"pilot2"}
];
PLANES.forEach(p=>{ p.mode = "plane"; TYPE[p.id] = p; });
DRIVER_KIND.pilot = {n:"Pilot", cut:0, fee:PILOT.fee, lvl:AIR_LVL};
Object.assign(CARGO, {express:{n:"Express documents",mult:1.3}, electronics:{n:"Electronics",mult:1.5}, medical:{n:"Medical supplies",mult:1.6}, perishables:{n:"Perishables",mult:1.4}});
const AIR_CARGO = ["parcels","express","electronics","medical","perishables"];
Object.assign(UNLOCKS, {20:"Air cargo (prop planes and pilots), road freight locomotive, car haulers", 24:"Turboprop freighter", 30:"Regional jet freighter, heavy-haul locomotive", 38:"Narrowbody freighter", 50:"Widebody freighter"});
