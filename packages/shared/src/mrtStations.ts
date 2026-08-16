import { z } from "zod";

export const MRT_STATIONS = [
  "Admiralty", "Aljunied", "Ang Mo Kio", "Bakau", "Bangkit", "Bartley", "Bayfront",
  "Bayshore", "Beauty World", "Bedok", "Bedok North", "Bedok Reservoir", "Bedok South",
  "Bencoolen", "Bendemeer", "Bishan", "Boon Keng", "Boon Lay", "Botanic Gardens",
  "Braddell", "Bras Basah", "Bright Hill", "Buangkok", "Bugis", "Bukit Batok",
  "Bukit Gombak", "Bukit Panjang", "Buona Vista", "Caldecott", "Cashew",
  "Changi Airport", "Cheng Lim", "Chinatown", "Chinese Garden", "Choa Chu Kang",
  "City Hall", "Clarke Quay", "Clementi", "Compassvale", "Coral Edge", "Cove",
  "Dakota", "Damai", "Dhoby Ghaut", "Downtown", "Dover", "Esplanade", "Eunos",
  "Expo", "Fajar", "Farmway", "Farrer Park", "Farrer Road", "Fernvale",
  "Fort Canning", "Gardens by the Bay", "Geylang Bahru", "Great World",
  "Gul Circle", "HarbourFront", "Havelock", "Haw Par Villa", "Holland Village",
  "Hougang", "Jalan Besar", "Joo Koon", "Jurong East", "Kadaloor", "Kaki Bukit",
  "Kallang", "Kangkar", "Katong Park", "Keat Hong", "Kembangan", "Kent Ridge",
  "Khatib", "King Albert Park", "Kovan", "Kranji", "Kupang", "Labrador Park",
  "Lakeside", "Lavender", "Layar", "Lentor", "Little India", "Lorong Chuan",
  "MacPherson", "Marina Bay", "Marina South Pier", "Marine Parade",
  "Marine Terrace", "Marsiling", "Marymount", "Mattar", "Maxwell", "Mayflower",
  "Meridian", "Mountbatten", "Napier", "Newton", "Nibong", "Nicoll Highway",
  "Novena", "Oasis", "one-north", "Orchard", "Orchard Boulevard", "Outram Park",
  "Pasir Panjang", "Pasir Ris", "Paya Lebar", "Pending", "Petir", "Phoenix",
  "Pioneer", "Potong Pasir", "Promenade", "Punggol", "Punggol Point",
  "Queenstown", "Raffles Place", "Ranggung", "Redhill", "Renjong", "Riviera",
  "Rochor", "Rumbia", "Sam Kee", "Samudera", "Segar", "Sembawang", "Sengkang",
  "Senja", "Serangoon", "Shenton Way", "Siglap", "Simei", "Sixth Avenue",
  "Somerset", "Soo Teck", "South View", "Springleaf", "Stadium", "Stevens",
  "Sumang", "Sungei Bedok", "Tai Seng", "Tampines", "Tampines East",
  "Tampines West", "Tan Kah Kee", "Tanah Merah", "Tanjong Katong",
  "Tanjong Pagar", "Tanjong Rhu", "Teck Lee", "Teck Whye", "Telok Ayer",
  "Telok Blangah", "Thanggam", "Tiong Bahru", "Toa Payoh", "Tongkang",
  "Tuas Crescent", "Tuas Link", "Tuas West Road", "Ubi", "Upper Changi",
  "Upper Thomson", "Woodlands", "Woodlands North", "Woodlands South",
  "Yew Tee", "Yio Chu Kang", "Yishun",
] as const;

export const mrtStationSchema = z.enum(MRT_STATIONS);
export type MrtStation = z.infer<typeof mrtStationSchema>;
