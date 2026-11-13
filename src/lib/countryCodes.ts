export interface CountryCode {
  code: string;
  country: string;
  flag: string;
  digitsMin: number;
  digitsMax: number;
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: '+228', country: 'Togo', flag: '🇹🇬', digitsMin: 8, digitsMax: 8 },
  { code: '+225', country: "Côte d'Ivoire", flag: '🇨🇮', digitsMin: 8, digitsMax: 10 },
  { code: '+229', country: 'Bénin', flag: '🇧🇯', digitsMin: 8, digitsMax: 10 },
  { code: '+233', country: 'Ghana', flag: '🇬🇭', digitsMin: 9, digitsMax: 10 },
  { code: '+234', country: 'Nigeria', flag: '🇳🇬', digitsMin: 8, digitsMax: 11 },
  { code: '+221', country: 'Sénégal', flag: '🇸🇳', digitsMin: 9, digitsMax: 9 },
  { code: '+226', country: 'Burkina Faso', flag: '🇧🇫', digitsMin: 8, digitsMax: 8 },
  { code: '+223', country: 'Mali', flag: '🇲🇱', digitsMin: 8, digitsMax: 8 },
  { code: '+227', country: 'Niger', flag: '🇳🇪', digitsMin: 8, digitsMax: 8 },
  { code: '+237', country: 'Cameroun', flag: '🇨🇲', digitsMin: 9, digitsMax: 9 },
  { code: '+224', country: 'Guinée', flag: '🇬🇳', digitsMin: 8, digitsMax: 9 },
  { code: '+241', country: 'Gabon', flag: '🇬🇦', digitsMin: 7, digitsMax: 9 },
  { code: '+242', country: 'Congo', flag: '🇨🇬', digitsMin: 9, digitsMax: 9 },
  { code: '+243', country: 'RD Congo', flag: '🇨🇩', digitsMin: 9, digitsMax: 10 },
  { code: '+33', country: 'France', flag: '🇫🇷', digitsMin: 9, digitsMax: 10 },
  { code: '+1', country: 'USA / Canada', flag: '🇺🇸', digitsMin: 10, digitsMax: 10 },
  { code: 'Autre', country: 'Autre pays', flag: '🌐', digitsMin: 6, digitsMax: 15 },
];

export function formatPhoneWithCountryCode(
  rawNumber: string,
  countryCode: string = '+228'
): { full: string; localDigits: string; country: string } {
  const trimmed = (rawNumber || '').trim();
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (countryCode === 'Autre') {
    const full = trimmed.startsWith('+') ? `+${digitsOnly}` : digitsOnly;
    return { full, localDigits: digitsOnly, country: 'Autre' };
  }
  const codeDigits = countryCode.replace(/\D/g, '');
  let localDigits = digitsOnly;
  if (trimmed.startsWith(countryCode)) {
    localDigits = digitsOnly.slice(codeDigits.length);
  } else if (codeDigits && digitsOnly.startsWith(codeDigits) && digitsOnly.length >= codeDigits.length + 7) {
    localDigits = digitsOnly.slice(codeDigits.length);
  }
  return {
    full: `${countryCode}${localDigits}`,
    localDigits,
    country: countryCode,
  };
}

export function validatePhoneNumber(digits: string, countryCode: string): boolean {
  const { localDigits } = formatPhoneWithCountryCode(digits, countryCode);
  if (countryCode === 'Autre') {
    return localDigits.length >= 6 && localDigits.length <= 15;
  }
  const match = COUNTRY_CODES.find((c) => c.code === countryCode);
  if (!match) return localDigits.length >= 8 && localDigits.length <= 10;
  return localDigits.length >= match.digitsMin && localDigits.length <= match.digitsMax;
}
