# Archived Player breakout outlook

`BreakoutOutlook.jsx` is the old BREAKOUT WATCH board: team, position, and stat filters, one card per player, the 0–100 gauge, recent opportunity (last 3 vs prior 3), matchup context, and the expandable trigger/risk notes.

Nothing in the app imports this folder, so Vite does not include it in the bundle. The live breakout index is `../breakout.js` (`breakoutRating`, `ratingLevel`), which Player projections and Flyers still use. Sorting still uses `betSignalScore` from `../Bets.jsx`.

## Inputs

`BreakoutOutlook` takes `{ data, matchup, roster, halfLife, window }`, the same values `MatchupExplorer` passes to Flyers and Parlays. `roster` is the roster map from `getRosters`, not the whole rosters object.

## Re-enable

Add one import where the board should render, then render the component:

```jsx
import BreakoutOutlook from './archive/BreakoutOutlook.jsx'

<BreakoutOutlook data={data} matchup={matchup} roster={roster} halfLife={halfLife} window={window} />
```

Delete this folder if the board is not coming back.
