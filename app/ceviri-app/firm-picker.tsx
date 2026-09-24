"use client";

import styles from "./lingua.module.css";

export type ClientOption = { id: string; name: string; slug: string };

/**
 * Firma seçici. "Otomatik": sistem belgeyi okuyup firmayı tahmin eder;
 * "Genel": firmasız, yalnızca genel terimce ve bellek.
 */
export default function FirmPicker({
  value,
  onChange,
  clients,
  disabled = false,
  allowAuto = true,
  label = "Firma",
}: {
  value: string;
  onChange: (value: string) => void;
  clients: ClientOption[];
  disabled?: boolean;
  allowAuto?: boolean;
  label?: string;
}) {
  return (
    <label className={styles.firm} title="Çeviri bu firmanın terimcesi ve belleğiyle yapılır">
      <span className={styles.firmLabel}>{label}</span>
      <select className={styles.firmSelect} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {allowAuto && <option value="auto">Otomatik</option>}
        <option value="none">Genel</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </label>
  );
}
