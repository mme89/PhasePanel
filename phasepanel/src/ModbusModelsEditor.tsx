import { newId } from '../shared/id.js';
import { useState } from 'react';
import {
  builtInModbusModelIds,
  type ModbusModel,
} from '../shared/modbusModels';
import { modbusCatalogByModelId } from '../shared/modbusCatalogs';
import { ModbusCatalogTable } from './ModbusCatalogTable';

type Mapping = ModbusModel['measurements'][number];

function addCatalogMapping(model: ModbusModel, value: Mapping): ModbusModel {
  const { measurement, channel, label, channelLabel, unit, address } = value;
  const blocks = [
    { firstRegister: model.firstRegister, registerCount: model.registerCount },
    ...(model.extraBlocks ?? []),
  ];
  const covered = blocks.some(
    (block) =>
      address >= block.firstRegister &&
      address + 1 < block.firstRegister + block.registerCount,
  );
  let nextFirst = model.firstRegister;
  let nextCount = model.registerCount;
  let nextExtra = model.extraBlocks ? [...model.extraBlocks] : undefined;

  if (!covered) {
    const overlapsOther = (start: number, count: number, ignoreIndex: number) =>
      blocks.some(
        (other, i) =>
          i !== ignoreIndex &&
          start < other.firstRegister + other.registerCount &&
          other.firstRegister < start + count,
      );

    let expanded = false;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (
        address === block.firstRegister + block.registerCount &&
        block.registerCount + 2 <= 125 &&
        block.firstRegister + block.registerCount + 2 <= 65536 &&
        !overlapsOther(block.firstRegister, block.registerCount + 2, i)
      ) {
        if (i === 0) nextCount = block.registerCount + 2;
        else
          nextExtra![i - 1] = {
            ...block,
            registerCount: block.registerCount + 2,
          };
        expanded = true;
        break;
      }
      if (
        address + 2 === block.firstRegister &&
        block.registerCount + 2 <= 125 &&
        !overlapsOther(address, block.registerCount + 2, i)
      ) {
        if (i === 0) {
          nextFirst = address;
          nextCount = block.registerCount + 2;
        } else {
          nextExtra![i - 1] = {
            firstRegister: address,
            registerCount: block.registerCount + 2,
          };
        }
        expanded = true;
        break;
      }
    }

    if (
      !expanded &&
      (nextExtra?.length ?? 0) < 8 &&
      address + 2 <= 65536 &&
      !overlapsOther(address, 2, -1)
    ) {
      nextExtra = [
        ...(nextExtra ?? []),
        { firstRegister: address, registerCount: 2 },
      ];
    }
  }

  return {
    ...model,
    firstRegister: nextFirst,
    registerCount: nextCount,
    ...(nextExtra ? { extraBlocks: nextExtra } : {}),
    measurements: [
      ...model.measurements,
      { measurement, channel, label, channelLabel, unit, address },
    ],
  };
}

export function ModbusModelsEditor({
  models,
  usedModelIds,
  onChange,
}: {
  models: ModbusModel[];
  usedModelIds: string[];
  onChange: (models: ModbusModel[]) => void;
}) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [mappingFilters, setMappingFilters] = useState<Record<string, string>>(
    {},
  );

  function toggleModel(id: string) {
    setOpenIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

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
    <div className="modbus-models-editor">
      <div className="modbus-models-toolbar">
        <span className="modbus-models-count">
          {models.length}{' '}
          {models.length === 1 ? 'device model' : 'device models'}
        </span>
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
            setOpenIds((current) => [...current, id]);
          }}
        >
          Add model
        </button>
      </div>
      {models.map((model, index) => {
        const isBuiltIn = (builtInModbusModelIds as readonly string[]).includes(
          model.id,
        );
        const catalog = modbusCatalogByModelId[model.id];
        const isOpen = openIds.includes(model.id);
        const mappingFilter = mappingFilters[model.id] ?? '';
        const query = mappingFilter.trim().toLowerCase();
        const indexedMappings = model.measurements
          .map((mapping, row) => ({ mapping, row }))
          .filter(({ mapping }) => {
            if (!query) return true;
            return `${mapping.measurement} ${mapping.channel} ${mapping.label} ${mapping.channelLabel} ${mapping.unit} ${mapping.address}`
              .toLowerCase()
              .includes(query);
          });

        return (
          <details key={model.id} className="modbus-model-card" open={isOpen}>
            <summary
              className="modbus-model-summary"
              onClick={(event) => {
                event.preventDefault();
                toggleModel(model.id);
              }}
            >
              <span className="modbus-model-title">
                {model.name || 'New model'}
              </span>
              <span className="modbus-model-badges">
                <span className="modbus-badge">
                  {isBuiltIn ? 'Built-in' : 'Custom'}
                </span>
                <span className="modbus-badge">
                  {model.measurements.length}{' '}
                  {model.measurements.length === 1 ? 'mapping' : 'mappings'}
                </span>
                {catalog && (
                  <span className="modbus-badge modbus-badge-muted">
                    {catalog.values.length.toLocaleString('en-US')} documented
                  </span>
                )}
              </span>
            </summary>
            <div className="modbus-model-body">
              <section className="editor-section modbus-section">
                <div className="editor-section-heading modbus-section-heading">
                  <div>
                    <h3>Model &amp; register blocks</h3>
                    <p>
                      Model ID: <code>{model.id}</code>
                    </p>
                  </div>
                  <div className="modbus-section-actions">
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
                    {!isBuiltIn && (
                      <button
                        type="button"
                        className="modbus-remove-block-button"
                        disabled={usedModelIds.includes(model.id)}
                        onClick={() => {
                          onChange(
                            models.filter((item) => item.id !== model.id),
                          );
                          setOpenIds((current) =>
                            current.filter((item) => item !== model.id),
                          );
                        }}
                      >
                        Remove model
                      </button>
                    )}
                  </div>
                </div>
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
              </section>

              <section className="editor-section modbus-section">
                <div className="editor-section-heading modbus-section-heading">
                  <div>
                    <div className="modbus-heading-row">
                      <h3>Configured mappings</h3>
                      <span className="editor-count">
                        {model.measurements.length}
                      </span>
                    </div>
                    <p>
                      Editable register mappings polled from the blocks above.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={model.measurements.length >= 250}
                    onClick={() => {
                      setMappingFilters((current) => ({
                        ...current,
                        [model.id]: '',
                      }));
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
                      });
                    }}
                  >
                    Add mapping
                  </button>
                </div>
                {model.measurements.length > 5 && (
                  <div className="modbus-catalog-toolbar">
                    <label>
                      Filter mappings
                      <input
                        value={mappingFilter}
                        onChange={(event) =>
                          setMappingFilters((current) => ({
                            ...current,
                            [model.id]: event.target.value,
                          }))
                        }
                        placeholder="Name, channel, unit or register"
                      />
                    </label>
                    <span role="status">
                      {query
                        ? `Showing ${indexedMappings.length} of ${model.measurements.length}`
                        : `${model.measurements.length} mappings`}
                    </span>
                  </div>
                )}
                <div className="source-settings-table-wrap modbus-table-wrap">
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
                      {indexedMappings.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="source-device-empty">
                            No mappings match &ldquo;{mappingFilter.trim()}
                            &rdquo;.
                          </td>
                        </tr>
                      ) : (
                        indexedMappings.map(({ mapping, row }) => (
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
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {catalog && (
                <ModbusCatalogTable
                  modelName={model.name || model.id}
                  catalog={catalog.values}
                  existingMappings={model.measurements}
                  canAdd={model.measurements.length < 250}
                  onAdd={(mapping) =>
                    onChange(
                      models.map((item, i) =>
                        i === index ? addCatalogMapping(item, mapping) : item,
                      ),
                    )
                  }
                />
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
