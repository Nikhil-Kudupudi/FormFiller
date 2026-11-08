/**
 * Add-another behaviour, as a form that clones markup actually does it.
 *
 * The clone keeps identical field names, which is the whole point: after
 * adding a row there is nothing in the markup saying which row is which.
 */
(function () {
  const clone = (rowsId, rowClass) => {
    const rows = document.getElementById(rowsId);
    const template = rows.querySelector(`.${rowClass}`);
    const copy = template.cloneNode(true);
    for (const field of copy.querySelectorAll('input')) field.value = '';
    rows.append(copy);
  };

  document
    .getElementById('add-education')
    .addEventListener('click', () => clone('edu-rows', 'edu-row'));

  document
    .getElementById('add-role')
    .addEventListener('click', () => clone('role-rows', 'role-row'));
})();
