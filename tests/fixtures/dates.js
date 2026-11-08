/**
 * Date-widget behaviours that break a naive filler.
 *
 * The day list is populated here rather than in the markup so it genuinely
 * overlaps the numeric month list on 1-12 -- which is the reason a month must
 * be identified before a day, not after.
 */
(function () {
  const day = document.getElementById('g-day');
  for (let d = 1; d <= 31; d++) {
    const option = document.createElement('option');
    option.textContent = String(d).padStart(2, '0');
    day.append(option);
  }

  // Ticking "I currently work here" removes the end-date fields, so anything
  // written into them beforehand goes with them.
  const current = document.getElementById('is-current');
  const wrap = document.getElementById('end-wrap');
  current.addEventListener('change', () => {
    wrap.hidden = current.checked;
    if (current.checked) {
      document.getElementById('e-month').value = '';
      document.getElementById('e-year').value = '';
    }
  });
})();
