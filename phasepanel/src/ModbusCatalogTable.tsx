import { useState } from 'react';
import { umg604Catalog } from '../shared/umg604Catalog';

const PAGE_SIZE = 100;

export function ModbusCatalogTable() {
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const query = filter.trim().toLowerCase();
  const matching = umg604Catalog.filter((value) =>
    `${value.measurement} ${value.channel} ${value.label} ${value.channelLabel} ${value.unit} ${value.address}`
      .toLowerCase()
      .includes(query),
  );
  const first = page * PAGE_SIZE;
  const visible = matching.slice(first, first + PAGE_SIZE);

  return (
    <section className="modbus-catalog">
      <h3>Documented electrical values ({umg604Catalog.length})</h3>
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
      <div className="source-settings-table-wrap">
        <table
          className="modbus-mapping-table modbus-catalog-table"
          aria-label="UMG 604-PRO documented electrical values"
        >
          <thead>
            <tr>
              <th scope="col">Measurement ID</th>
              <th scope="col">Channel</th>
              <th scope="col">Name</th>
              <th scope="col">Channel name</th>
              <th scope="col">Unit</th>
              <th scope="col">Register</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((value) => (
              <tr key={value.address}>
                <td>{value.measurement}</td>
                <td>{value.channel}</td>
                <td>{value.label}</td>
                <td>{value.channelLabel}</td>
                <td>{value.unit || '—'}</td>
                <td>{value.address}</td>
              </tr>
            ))}
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
    </section>
  );
}
