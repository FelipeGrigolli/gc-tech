// Initial fleet data, copied from web/js/gc-fleet-data.js so the API and the
// prototype agree on categories and plates. The plate generator must stay
// identical to the web one (same seed, same order), otherwise plates differ.

const categories = [
  { id: 'small-auto',   section: 'Passenger',  name: 'SMALL CAR AUTOMATIC',         model: 'Toyota Yaris',                label: 'Yaris 4Dr',          rate: 59.00,  fuel: 'Petrol', seats: 5 },
  { id: 'small-new',    section: 'Passenger',  name: 'SMALL CAR AUTOMATIC-NEW',     model: 'New Toyota Yaris',            label: 'Yaris 4Dr (New)',    rate: 64.00,  fuel: 'Petrol', seats: 5 },
  { id: 'small-hybrid', section: 'Passenger',  name: 'SMALL CAR HYBRID',            model: 'Hybrid Toyota Yaris',         label: 'Yaris Hybrid',       rate: 67.00,  fuel: 'Hybrid', seats: 5 },
  { id: 'mid-hatch',    section: 'Passenger',  name: 'MID SIZE CAR HATCH HYBRID',   model: 'Toyota Corolla',              label: 'Corolla Hatch',      rate: 72.00,  fuel: 'Hybrid', seats: 5 },
  { id: 'mid-sedan',    section: 'Passenger',  name: 'MID SIZE CAR SEDAN HYBRID',   model: 'Toyota Corolla Sedan',        label: 'Corolla Sedan',      rate: 74.00,  fuel: 'Hybrid', seats: 5 },
  { id: 'full-car',     section: 'Passenger',  name: 'FULL SIZE CAR HYBRID',        model: 'Toyota Camry',                label: 'Camry',              rate: 79.00,  fuel: 'Hybrid', seats: 5 },
  { id: 'mid-suv',      section: 'Passenger',  name: 'MID SIZE SUV',                model: 'Mitsubishi ASX',              label: 'ASX',                rate: 76.00,  fuel: 'Petrol', seats: 5 },
  { id: 'cross-suv',    section: 'Passenger',  name: 'MID SIZE CROSS SUV',          model: 'Toyota Corolla Cross',        label: 'Corolla Cross',      rate: 81.00,  fuel: 'Hybrid', seats: 5 },
  { id: 'mid-7seat',    section: 'Passenger',  name: 'MID SIZE 7 SEATER SUV',       model: 'Mitsubishi Outlander',        label: 'Outlander 7 Seater', rate: 95.00,  fuel: 'Petrol', seats: 7 },
  { id: 'full-7seat',   section: 'Passenger',  name: 'FULL SIZE 7 SEATER HYBRID',   model: 'Hybrid Toyota Kluger',        label: 'Kluger Hybrid',      rate: 129.00, fuel: 'Hybrid', seats: 7 },
  { id: 'eight-seat',   section: 'Passenger',  name: 'EIGHT SEATER AUTOMATIC',      model: 'Hyundai Staria',              label: 'Staria 8 Seater',    rate: 139.00, fuel: 'Diesel', seats: 8 },
  { id: 'hiace-1t',     section: 'Commercial', name: 'TOYOTA HIACE 1T VAN AUTO',    model: 'Toyota Hiace 1T Van',         label: 'Hiace 1T Van',       rate: 85.00,  fuel: 'Diesel', seats: 3 },
  { id: 'hiace-15t',    section: 'Commercial', name: 'TOYOTA HIACE 1.5T VAN AUTO',  model: 'Toyota Hiace 1.5T Van',       label: 'Hiace 1.5T Van',     rate: 99.00,  fuel: 'Diesel', seats: 3 },
  { id: 'pantech',      section: 'Commercial', name: 'PANTECH TRUCK + TAIL LIFT',   model: 'Auto Pantech Truck',          label: 'Hino 300 Pantech',   rate: 159.00, fuel: 'Diesel', seats: 3 },
  { id: 'hilux-auto',   section: 'Commercial', name: 'TOYOTA HILUX UTILITY AUTO',   model: 'Toyota Hilux Utility Auto',   label: 'Hilux Ute Auto',     rate: 72.00,  fuel: 'Diesel', seats: 5 },
  { id: 'hilux-diesel', section: 'Commercial', name: 'TOYOTA HILUX UTILITY DIESEL', model: 'Toyota Hilux Utility DIESEL', label: 'Hilux Ute 4x4',      rate: 78.00,  fuel: 'Diesel', seats: 5 },
];

const branches = [
  { code: 'PAR', name: 'Sydney - Parramatta' },
  { code: 'MAS', name: 'Sydney - Mascot' },
  { code: 'BLK', name: 'Sydney - Blacktown' },
  { code: 'NSY', name: 'Sydney - North Sydney' },
  { code: 'EGF', name: 'Brisbane - Eagle Farm' },
  { code: 'WGB', name: 'Brisbane - Woolloongabba' },
];

const VEHICLES_PER_CATEGORY = 10;

// Same deterministic generator as the web (buildFleetVehicles).
function buildVehicles() {
  let seed = 20260929;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const letter = () => letters[Math.floor(rand() * letters.length)];
  const branchRotation = ['PAR', 'MAS', 'PAR', 'BLK', 'NSY', 'MAS', 'PAR', 'EGF', 'WGB', 'BLK'];
  const used = new Set();
  const vehicles = [];

  categories.forEach((cat) => {
    for (let i = 0; i < VEHICLES_PER_CATEGORY; i++) {
      let plate;
      do {
        plate = letter() + letter() + String(Math.floor(rand() * 90) + 10) + letter() + letter();
      } while (used.has(plate));
      used.add(plate);
      vehicles.push({ plate, categoryId: cat.id, branch: branchRotation[i] });
    }
  });
  return vehicles;
}

module.exports = { categories, branches, buildVehicles };
