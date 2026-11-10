export interface CountryCode {
  code: string;
  country: string;
  flag: string;
  digitsMin: number;
  digitsMax: number;
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: '+228', country: 'Togo', flag: '🇹🇬', digitsMin: 8, digitsMax: 8 },
  { code: '+229', country: 'Bénin', flag: '🇧🇯', digitsMin: 8, digitsMax: 10 },
  { code: '+225', country: "Côte d'Ivoire", flag: '🇨🇮', digitsMin: 8, digitsMax: 10 },
  { code: '+233', country: 'Ghana', flag: '🇬🇭', digitsMin: 9, digitsMax: 10 },
  { code: '+221', country: 'Sénégal', flag: '🇸🇳', digitsMin: 9, digitsMax: 9 },
  { code: '+226', country: 'Burkina Faso', flag: '🇧🇫', digitsMin: 8, digitsMax: 8 },
  { code: '+223', country: 'Mali', flag: '🇲🇱', digitsMin: 8, digitsMax: 8 },
  { code: '+227', country: 'Niger', flag: '🇳🇪', digitsMin: 8, digitsMax: 8 },
  { code: '+33', country: 'France', flag: '🇫🇷', digitsMin: 9, digitsMax: 10 },
  { code: '+1', country: 'USA / Canada', flag: '🇺🇸', digitsMin: 10, digitsMax: 10 },
  { code: 'Autre', country: 'Autre pays', flag: '🌐', digitsMin: 6, digitsMax: 15 },
];

export function validatePhoneNumber(digits: string, countryCode: string): boolean {
  const cleanDigits = digits.replace(/\D/g, '');
  if (countryCode === 'Autre') {
    return cleanDigits.length >= 6 && cleanDigits.length <= 15;
  }
  const match = COUNTRY_CODES.find((c) => c.code === countryCode);
  if (!match) return cleanDigits.length >= 8 && cleanDigits.length <= 10;
  return cleanDigits.length >= match.digitsMin && cleanDigits.length <= match.digitsMax;
}
