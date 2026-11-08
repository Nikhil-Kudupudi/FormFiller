/**
 * A faithful stand-in for React's controlled-input behaviour.
 *
 * Loading real React here would make the fixture heavy and version-dependent.
 * What actually matters is the mechanism that breaks naive autofill, and it is
 * small enough to reproduce exactly:
 *
 *   1. React installs its own accessor over `value` on the DOM node.
 *   2. It keeps a `_valueTracker` holding the last value it observed.
 *   3. On an `input` event it compares the current value to the tracker. If
 *      they match it concludes nothing changed and swallows the event, so
 *      `onChange` never runs and component state never updates.
 *   4. On the next render it writes state back over the DOM value.
 *
 * A fill that does not reset the tracker will leave the visible input looking
 * correct while `#react-echo` stays empty -- and a real form would submit the
 * empty state. That divergence is what the test asserts on.
 */
(function () {
  const field = document.getElementById('react-field');
  const echo = document.getElementById('react-echo');
  if (!field || !echo) return;

  let state = '';

  // (2) the value tracker
  let tracked = '';
  Object.defineProperty(field, '_valueTracker', {
    value: {
      getValue: () => tracked,
      setValue: (v) => {
        tracked = v;
      },
      stopTracking: () => {},
    },
    configurable: true,
  });

  // (1) an instance accessor shadowing the prototype's
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(field, 'value', {
    get() {
      return proto.get.call(this);
    },
    set(v) {
      tracked = String(v); // the side effect that defeats a naive fill
      proto.set.call(this, v);
    },
    configurable: true,
  });

  const render = () => {
    proto.set.call(field, state); // (4) state wins on render
    tracked = state;
    echo.textContent = state === '' ? '(empty)' : state;
  };

  // (3) the swallow
  field.addEventListener('input', () => {
    const current = proto.get.call(field);
    if (current === tracked) return; // no change seen -> event swallowed
    tracked = current;
    state = current;
    echo.textContent = state === '' ? '(empty)' : state;
  });

  // Force a re-render shortly after load, the way a real app would, so a fill
  // that only looked successful gets overwritten and the divergence shows.
  window.__forceRender = render;
})();
