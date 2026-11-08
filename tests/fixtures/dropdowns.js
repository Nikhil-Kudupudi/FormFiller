/**
 * Behaviours of real custom dropdowns, reproduced exactly enough to break a
 * naive filler.
 *
 * Each widget here corresponds to something reported as a common failure:
 * a portalled menu, a mousedown-to-open control that a plain click closes
 * again, a keyboard-only control, an async list that answers out of order
 * behind a clickable "Loading…" row, a chip tray that masquerades as a
 * listbox, and an option set where a prefix match is ambiguous.
 */
(function () {
  const COUNTRIES = [
    'Canada',
    'United States Minor Outlying Islands',
    'United States of America',
    'United Kingdom',
  ];
  const DEGREES = ["Bachelor's Degree", "Master's Degree", 'Doctorate'];
  const STATES = ['Virginia Beach', 'Virginia', 'West Virginia', 'Massachusetts'];
  const SKILLS = ['TypeScript', 'Rust', 'Go'];
  const SCHOOLS = [
    { id: 'mit-1', name: 'Massachusetts Institute of Technology' },
    { id: 'msu-2', name: 'Massachusetts State University' },
    { id: 'uma-3', name: 'University of Massachusetts' },
  ];

  const option = (text) => {
    const el = document.createElement('div');
    el.className = 'opt';
    el.setAttribute('role', 'option');
    el.textContent = text;
    return el;
  };

  const setDisplay = (control, text) => {
    const span = control.querySelector('.value, .select__single-value');
    span.textContent = text;
    span.classList.remove('placeholder');
  };

  /* -- 1. Portalled menu, opens on mousedown, closes on a plain click ----- */
  (function portalled() {
    const control = document.getElementById('country-control');
    let menu = null;

    const close = () => {
      if (menu) menu.remove();
      menu = null;
      control.setAttribute('aria-expanded', 'false');
    };

    // Opens on mousedown, like react-select.
    control.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (menu) return;
      menu = document.createElement('div');
      menu.className = 'menu select__menu';
      menu.setAttribute('role', 'listbox');
      const rect = control.getBoundingClientRect();
      menu.style.left = `${rect.left + scrollX}px`;
      menu.style.top = `${rect.bottom + scrollY}px`;
      for (const name of COUNTRIES) {
        const el = option(name);
        el.className = 'opt select__option';
        el.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          setDisplay(control, name);
          close();
        });
        menu.append(el);
      }
      // Portalled to body, nowhere near the control that owns it.
      document.body.append(menu);
      control.setAttribute('aria-expanded', 'true');
    });

    // A plain .click() fires mousedown then mouseup; this blur-on-mouseup
    // behaviour is what makes click-only openers fail on these widgets.
    document.addEventListener('mousedown', (e) => {
      if (menu && !menu.contains(e.target) && e.target !== control) close();
    });
  })();

  /* -- 2. Keyboard only --------------------------------------------------- */
  (function keyboardOnly() {
    const control = document.getElementById('degree-control');
    const menu = document.getElementById('degree-menu');

    const render = () => {
      menu.replaceChildren();
      for (const name of DEGREES) {
        const el = option(name);
        el.addEventListener('click', () => {
          setDisplay(control, name);
          menu.hidden = true;
        });
        menu.append(el);
      }
    };

    // Deliberately no mouse handler on the control.
    control.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        render();
        menu.hidden = false;
      }
      if (e.key === 'Escape') menu.hidden = true;
    });
  })();

  /* -- 3. Async typeahead, out of order, with a Loading row --------------- */
  (function typeahead() {
    const input = document.getElementById('school');
    const menu = document.getElementById('school-menu');
    const hidden = document.getElementById('school_id');
    let sequence = 0;

    input.addEventListener('input', () => {
      const query = input.value.trim();
      menu.hidden = false;

      if (query.length < 3) {
        menu.replaceChildren(Object.assign(document.createElement('div'), {
          className: 'status',
          textContent: 'Type to search',
        }));
        return;
      }

      // A clickable status row: picking it would submit "Loading…" as the
      // user's school.
      const loading = option('Loading…');
      loading.className = 'opt status';
      menu.replaceChildren(loading);

      const mine = ++sequence;
      // Deliberately variable, so an early response can land after a later
      // one and leave stale results on screen.
      const delay = 120 + Math.floor(Math.random() * 400);

      setTimeout(() => {
        // Out-of-order guard on the page's side is deliberately absent for
        // the first render, then corrected -- which is what makes the list
        // change shape after it first appears.
        const matches = SCHOOLS.filter((s) =>
          s.name.toLowerCase().includes(query.toLowerCase()),
        );
        if (mine !== sequence) return;
        menu.replaceChildren();
        for (const school of matches) {
          const el = option(school.name);
          el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = school.name;
            // The value the form actually submits. Typing alone never sets
            // this, which is why a typed-but-unchosen field is empty.
            hidden.value = school.id;
            menu.hidden = true;
          });
          menu.append(el);
        }
        if (matches.length === 0) {
          menu.replaceChildren(Object.assign(document.createElement('div'), {
            className: 'status',
            textContent: 'No results',
          }));
        }
      }, delay);
    });
  })();

  /* -- 4. Multiselect whose chip tray is also a listbox ------------------- */
  (function multiselect() {
    const control = document.getElementById('skills-control');
    const menu = document.getElementById('skills-menu');

    control.addEventListener('click', () => {
      menu.replaceChildren();
      for (const name of SKILLS) {
        const el = option(name);
        el.addEventListener('click', () => {
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.setAttribute('role', 'option');
          chip.textContent = name;
          control.querySelector('.chips').append(chip);
          setDisplay(control, name);
          menu.hidden = true;
        });
        menu.append(el);
      }
      menu.hidden = false;
    });
  })();

  /* -- 5. Ambiguous prefixes ---------------------------------------------- */
  (function ambiguous() {
    const control = document.getElementById('state-control');
    const menu = document.getElementById('state-menu');

    control.addEventListener('click', () => {
      menu.replaceChildren();
      for (const name of STATES) {
        const el = option(name);
        el.addEventListener('click', () => {
          setDisplay(control, name);
          menu.hidden = true;
        });
        menu.append(el);
      }
      menu.hidden = false;
    });
  })();
})();
