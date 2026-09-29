import { newId } from '../shared/id.js';
import { useState } from 'react';
import { defaultModbusModel, type ModbusModel } from '../shared/modbusModels';
import { ModbusCatalogTable } from './ModbusCatalogTable';

type Mapping = ModbusModel['measurements'][number];

export function ModbusModelsEditor({
  models,
  usedModelIds,
  onChange,
}: {
  models: ModbusModel[];
  usedModelIds: string[];
  onChange: (models: ModbusModel[]) => void;
}) {
  const [newModelId, setNewModelId] = useState('');

  function updateModel(index: number, change: Partial<ModbusModel>) {
    onChange(
      models.map((model, i) => (i === index ? { ...model, ...change } : model)),
    );
  }

  function updateMapping(index: number, row: number, change: Partial<Mapping>) {
    updateModel(index, {
      measurements: models[index].measurements.map((mapping, i) =>
        i === row ? { ...mapping, ...change } : mapping,
      ),
    });
  }

  return (
    <fieldset className="display-settings modbus-models-editor">
      <legend>Device models and mappings</legend>
      <button
        type="button"
        disabled={models.length >= 100}
        onClick={() => {
          const id = `custom-${newId()}`;
          onChange([
            ...models,
            {
              id,
              name: '',
              firstRegister: 0,
              registerCount: 2,
              measurements: [
                {
                  measurement: '',
                  channel: '',
                  label: '',
                  channelLabel: '',
                  unit: '',
                  address: 0,
                },
              ],
            },
          ]);
          setNewModelId(id);
        }}
      >
        Add model
      </button>
      {models.map((model, index) => (
        <details
          key={model.id}
          open={model.id === newModelId ? true : undefined}
        >
          <summary>{model.name || 'New model'}</summary>
          <div className="modbus-model-fields">
            <label>
              Model name
              <input
                required
                maxLength={200}
                value={model.name}
                onChange={(event) =>
                  updateModel(index, { name: event.target.value })
                }
              />
            </label>
            <label>
              First register
              <input
                required
                type="number"
                min="0"
                max="65535"
                value={model.firstRegister}
                onChange={(event) =>
                  updateModel(index, {
                    firstRegister: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Register count
              <input
                required
                type="number"
                min="2"
                max="125"
                value={model.registerCount}
                onChange={(event) =>
                  updateModel(index, {
                    registerCount: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          {(model.extraBlocks ?? []).map((block, blockIndex) => (
            <div
              className="modbus-model-fields modbus-read-block-fields"
              key={blockIndex}
            >
              <label>
                Additional block {blockIndex + 1} first register
                <input
                  type="number"
                  min="0"
                  max="65535"
                  value={block.firstRegister}
                  onChange={(event) =>
                    updateModel(index, {
                      extraBlocks: model.extraBlocks!.map((current, i) =>
                        i === blockIndex
                          ? {
                              ...current,
                              firstRegister: Number(event.target.value),
                            }
                          : current,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Register count
                <input
                  type="number"
                  min="2"
                  max="125"
                  value={block.registerCount}
                  onChange={(event) =>
                    updateModel(index, {
                      extraBlocks: model.extraBlocks!.map((current, i) =>
                        i === blockIndex
                          ? {
                              ...current,
                              registerCount: Number(event.target.value),
                            }
                          : current,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="modbus-remove-block-button"
                onClick={() =>
                  updateModel(index, {
                    extraBlocks: model.extraBlocks!.filter(
                      (_, i) => i !== blockIndex,
                    ),
                  })
                }
              >
                Remove block
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={(model.extraBlocks?.length ?? 0) >= 8}
            onClick={() =>
              updateModel(index, {
                extraBlocks: [
                  ...(model.extraBlocks ?? []),
                  { firstRegister: 0, registerCount: 2 },
                ],
              })
            }
          >
            Add read block
          </button>
          <small>Model ID: {model.id}</small>
          <div className="source-settings-table-wrap">
            <table
              className="modbus-mapping-table"
              aria-label={`Mappings for ${model.name || 'new model'}`}
            >
              <thead>
                <tr>
                  <th scope="col">Measurement ID</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Name</th>
                  <th scope="col">Channel name</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Register</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {model.measurements.map((mapping, row) => (
                  <tr key={row}>
                    {(
                      [
                        'measurement',
                        'channel',
                        'label',
                        'channelLabel',
                        'unit',
                      ] as const
                    ).map((field) => (
                      <td key={field}>
                        <input
                          aria-label={`${field} for ${model.name || 'new model'} mapping ${row + 1}`}
                          required={field !== 'unit'}
                          value={mapping[field]}
                          onChange={(event) =>
                            updateMapping(index, row, {
                              [field]: event.target.value,
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <input
                        aria-label={`Register for ${model.name || 'new model'} mapping ${row + 1}`}
                        required
                        type="number"
                        min="0"
                        max="65535"
                        value={mapping.address}
                        onChange={(event) =>
                          updateMapping(index, row, {
                            address: Number(event.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Remove mapping ${row + 1} from ${model.name || 'new model'}`}
                        disabled={model.measurements.length === 1}
                        onClick={() =>
                          updateModel(index, {
                            measurements: model.measurements.filter(
                              (_, i) => i !== row,
                            ),
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modbus-model-actions">
            <button
              type="button"
              disabled={model.measurements.length >= 250}
              onClick={() =>
                updateModel(index, {
                  measurements: [
                    ...model.measurements,
                    {
                      measurement: '',
                      channel: '',
                      label: '',
                      channelLabel: '',
                      unit: '',
                      address: model.firstRegister,
                    },
                  ],
                })
              }
            >
              Add mapping
            </button>
            {model.id !== defaultModbusModel && (
              <button
                type="button"
                disabled={usedModelIds.includes(model.id)}
                onClick={() =>
                  onChange(models.filter((item) => item.id !== model.id))
                }
              >
                Remove model
              </button>
            )}
          </div>
          {model.id === defaultModbusModel && <ModbusCatalogTable />}
        </details>
      ))}
    </fieldset>
  );
}
