import { listGeoCountries, listGeoCities } from '../backend/utils/geo-lookup.ts';

const countries = await listGeoCountries();
console.log('countries', countries.length);

const uy = countries.find((country) => country.iso2 === 'UY');
console.log('uruguay', uy);

const cities = await listGeoCities('Uruguay');
console.log('cities', cities.length, cities.slice(0, 5));
