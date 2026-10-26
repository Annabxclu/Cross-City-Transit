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
  hazmat:{n:"Hazmat fuel",mult:1.8}, vehicles:{n:"Vehicles",mult:1.5}
};
const PRODUCERS = {general:["Warehouse","Factory","Distribution Center"],parcels:["Parcel Hub","Warehouse"],furniture:["Furniture Maker"],pallets:["Bottling Plant","Paper Mill","Factory"],refrigerated:["Farm","Food Processor","Dairy"],lumber:["Lumber Yard","Sawmill"],steel:["Steel Mill"],machinery:["Machine Shop","Equipment Factory"],liquids:["Chemical Plant","Water Bottler"],hazmat:["Refinery"],vehicles:["Auto Plant","Vehicle Port"]};
const ACCEPTORS = {general:["Retail Store","Grocery Distribution Center","Hardware Store"],parcels:["Retail Store","Hospital","Office Park"],furniture:["Furniture Store","Hotel"],pallets:["Grocery Distribution Center","Big-Box Store","Warehouse"],refrigerated:["Grocery Distribution Center","Restaurant Supplier","Hospital"],lumber:["Construction Site","Hardware Store"],steel:["Construction Site","Manufacturing Plant"],machinery:["Construction Site","Manufacturing Plant","Farm"],liquids:["Manufacturing Plant","Water Treatment Plant"],hazmat:["Fuel Depot","Airport Fuel Farm"],vehicles:["Car Dealership"]};

const TYPES = [
  {id:"van",n:"Cargo van",price:35000,cap:3000,leg:300,cargo:["general","parcels"],lic:"std",lvl:1,big:false},
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
  owner:{n:"Owner",cut:0}, std:{n:"Driver",cut:.25,fee:1000,lvl:1}, cdl:{n:"CDL driver",cut:.22,fee:5000,lvl:6}
};
const FIRST = ["Marcus","Dana","Luis","Keisha","Travis","Rosa","Dwayne","Megan","Andre","Tasha","Cody","Imani","Hector","Brianna","Jamal","Lena","Wyatt","Carmen","Darnell","Shelby","Omar","Kayla","Reggie","Nina"];
const LAST = ["Brooks","Ortiz","Hale","Washington","Price","Nguyen","Carter","Reyes","Mills","Jenkins","Parker","Diaz","Cole","Bishop","Foster","Ramos","Banks","Lowe","Grant","Avery"];
const DRV_LEVELS = [0,5,15,30,50];
const GARAGE_PRICE = 40000, GARAGE_LVL = 3, SLOT_PRICE = 15000, DISPATCH_PRICE = 15000, DISPATCH_LVL = 8, HAZMAT_PRICE = 10000;
const RADIUS_MI = 150, MAX_DEADHEAD = 450, BOARD_PER_BASE = 10, MIN = 60000;
const UNLOCKS = {2:"Box truck",3:"Second garage",5:"Reefer box truck",6:"CDL drivers and straight truck",8:"Dispatchers",10:"Semi + dry van",12:"Semi + reefer",14:"Semi + flatbed",15:"Rail depots (next build)",18:"Tankers and hazmat training",20:"Car haulers, air cargo (next build)",25:"Team-driven semi"};


/* Hub sizes: every garage starts Small and can be upgraded. */
const HUB_TIERS = [
  {n:"Small hub",  cap:10, price:0,      lvl:1},
  {n:"Medium hub", cap:20, price:75000,  lvl:4},
  {n:"Large hub",  cap:30, price:200000, lvl:10}
];
const JOB_EVERY_MS = 30000;   // a new job posts every 30 seconds while the board has room

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
