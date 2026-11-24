import { useState } from 'react';
import type { CatalogValue } from '../shared/modbusCatalogs';
import type { ModbusModel } from '../shared/modbusModels';

type Mapping = ModbusModel['measurements'][number];

const PAGE_SIZE = 100;

function mappingKey(measurement: string, channel: string) {
  return JSON.stringify([measurement, channel]);
}

export function ModbusCatalogTable({
  modelName,
  catalog,
  existingMappings,
  canAdd,
  onAdd,
}: {
  modelName: string;
  catalog: readonly CatalogValue[];
  existingMappings: Mapping[];
  canAdd: boolean;
  onAdd: (mapping: Mapping) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const query = filter.trim().toLowerCase();
  const existingKeys = new Set(
    existingMappings.map((item) => mappingKey(item.measurement, item.channel)),
  );
  const matching = expanded
    ? catalog.filter((value) =>
        `${value.measurement} ${value.channel} ${value.label} ${value.channelLabel} ${value.unit} ${value.address}`
          .toLowerCase()
          .includes(query),
      )
    : [];
  const first = page * PAGE_SIZE;
  const visible = matching.slice(first, first + PAGE_SIZE);

  return (
    <section className="editor-section modbus-section modbus-catalog">
      <div className="editor-section-heading modbus-section-heading">
        <div>
          <div className="modbus-heading-row">
            <h3>Documented electrical values ({catalog.length})</h3>
          </div>
          <p>
            Read-only {modelName} register catalog. All values remain available
            when choosing measurements for widgets, or add them above to edit
            their mapping.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Hide catalog' : 'Browse catalog'}
        </button>
      </div>
      {expanded && (
        <div className="modbus-catalog-body">
          <div className="modbus-catalog-toolbar">
            <label>
              Filter values
              <input
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(0);
                }}
                placeholder="Name, channel, unit or register"
              />
            </label>
            <span role="status">
              {matching.length === 0
                ? 'No matching values'
                : `Showing ${first + 1}–${first + visible.length} of ${matching.length}`}
            </span>
          </div>
          <div className="source-settings-table-wrap modbus-table-wrap">
            <table
              className="modbus-mapping-table modbus-catalog-table"
              aria-label={`${modelName} documented electrical values`}
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
                {visible.map((value) => {
                  const added = existingKeys.has(
                    mappingKey(value.measurement, value.channel),
                  );
                  return (
                    <tr key={value.address}>
                      <td>{value.measurement}</td>
                      <td>{value.channel}</td>
                      <td>{value.label}</td>
                      <td>{value.channelLabel}</td>
                      <td>{value.unit || '—'}</td>
                      <td>{value.address}</td>
                      <td>
                        <button
                          type="button"
                          disabled={added || !canAdd}
                          aria-label={`Add ${value.measurement} ${value.channel} (register ${value.address})`}
                          onClick={() =>
                            onAdd({
                              measurement: value.measurement,
                              channel: value.channel,
                              label: value.label,
                              channelLabel: value.channelLabel,
                              unit: value.unit,
                              address: value.address,
                            })
                          }
                        >
                          {added ? 'Added' : 'Add'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {matching.length > PAGE_SIZE && (
            <div className="modbus-catalog-pages">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </button>
              <span>
                Page {page + 1} of {Math.ceil(matching.length / PAGE_SIZE)}
              </span>
              <button
                type="button"
                disabled={first + PAGE_SIZE >= matching.length}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
