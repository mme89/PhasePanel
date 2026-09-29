import { useState } from 'react';
import { z } from 'zod';
import {
  defaultModbusModel,
  modbusModelSchema,
  type ModbusModel,
} from '../shared/modbusModels';
import { Modal } from './Modal';
import { ModbusModelsEditor } from './ModbusModelsEditor';

export function ModbusModelsDialog({
  models,
  usedModelIds,
  onApply,
  onClose,
}: {
  models: ModbusModel[];
  usedModelIds: string[];
  onApply: (models: ModbusModel[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(models));
  const [error, setError] = useState('');

  function apply() {
    const parsed = z.array(modbusModelSchema).min(1).max(100).safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(`${issue.path.join('.')}: ${issue.message}`);
      return;
    }
    const ids = parsed.data.map((model) => model.id);
    const names = parsed.data.map((model) => model.name.toLocaleLowerCase());
    if (
      new Set(ids).size !== ids.length ||
      new Set(names).size !== names.length
    ) {
      setError('Model IDs and names must be unique.');
      return;
    }
    if (
      !ids.includes(defaultModbusModel) ||
      usedModelIds.some((id) => !ids.includes(id))
    ) {
      setError('Keep every model used by a device and the UMG 604-PRO model.');
      return;
    }
    onApply(parsed.data);
  }

  return (
    <Modal
      labelledBy="modbus-models-title"
      className="modbus-models-shell"
      onClose={onClose}
    >
      <section className="modal modbus-models-modal">
        <span className="eyebrow">DIRECT MODBUS/TCP</span>
        <h2 id="modbus-models-title">Device models and mappings</h2>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <ModbusModelsEditor
          models={draft}
          usedModelIds={usedModelIds}
          onChange={(models) => {
            setDraft(models);
            setError('');
          }}
        />
        <footer className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="button" onClick={apply}>
            Apply models
          </button>
        </footer>
      </section>
    </Modal>
  );
}
