import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizePhone(value: string, defaultCountry: "BR" = "BR"): string | null {
  const phone = parsePhoneNumberFromString(value, defaultCountry);
  return phone?.isValid() ? phone.number : null;
}
