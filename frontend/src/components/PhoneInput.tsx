import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { COUNTRIES, countryForDial, flag, splitPhone } from '../countries'

/**
 * Country calling code + number, stored as one string ("+44 7700 900123") so the CV, the AI and older
 * saves keep working. No code is preselected: an empty or code-less number stays as it is.
 */
export function PhoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { dial, rest } = splitPhone(value)
  // +1 and +7 are shared: remember which country was picked while the code still matches
  const [picked, setPicked] = useState<string | null>(null)
  const pickedCountry = COUNTRIES.find((c) => c.iso === picked)
  const country = pickedCountry && pickedCountry.dial === dial ? pickedCountry : countryForDial(dial)

  const join = (code: string, number: string) => (code ? `+${code}${number ? ` ${number}` : ''}` : number)

  // in international format the national trunk 0 is dropped (+964 770…, not +964 0770…); Italy keeps it
  const dropTrunkZero = (code: string, number: string) => (code && code !== '39' ? number.replace(/^0(?!0)/, '') : number)

  const pickCountry = (iso: string) => {
    const c = COUNTRIES.find((x) => x.iso === iso)
    setPicked(iso || null)
    onChange(join(c?.dial ?? '', dropTrunkZero(c?.dial ?? '', rest)))
  }

  const typeNumber = (v: string) => {
    // a pasted or typed "+44 …" / "0044 …" carries its own code
    onChange(/^\s*(\+|00)/.test(v) ? v.trimStart() : join(dial, v))
  }

  return (
    <div className="phone-input">
      <div className={`phone-code ${country ? '' : 'empty'}`}>
        <span aria-hidden>{country ? `${flag(country.iso)} +${country.dial}` : 'Code'}</span>
        <ChevronDown size={14} aria-hidden />
        <select aria-label="Country calling code" value={country?.iso ?? ''} onChange={(e) => pickCountry(e.target.value)}>
          <option value="">No country code</option>
          {COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.name} +{c.dial}
            </option>
          ))}
        </select>
      </div>
      <input
        className="input"
        type="tel"
        aria-label="Phone number"
        value={country ? rest : value}
        onChange={(e) => typeNumber(e.target.value)}
        onBlur={() => dial && dropTrunkZero(dial, rest) !== rest && onChange(join(dial, dropTrunkZero(dial, rest)))}
        placeholder={country ? '770 000 0000' : 'Phone number'}
        autoComplete={country ? 'tel-national' : 'tel'}
      />
    </div>
  )
}
