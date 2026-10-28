import { OPENCODE_MODALITY_OPTIONS } from "../../types/providerConfig";

interface ModalityMultiSelectProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}

export function ModalityMultiSelect({
  label,
  value,
  onChange,
}: ModalityMultiSelectProps) {
  const toggle = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter((item) => item !== option));
      return;
    }
    onChange([...value, option]);
  };

  return (
    <div className="preferences-field preferences-modality-field">
      <label>{label}</label>
      <div className="preferences-modality-options">
        {OPENCODE_MODALITY_OPTIONS.map((option) => (
          <label key={option} className="preferences-modality-option">
            <input
              type="checkbox"
              checked={value.includes(option)}
              onChange={() => toggle(option)}
            />{" "}
            {option}
          </label>
        ))}
      </div>
    </div>
  );
}
