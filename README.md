# Case study: biotech (synthetic)

Robotic Arm 3 has raised alarm **E-14**. It looks like gripper wear, the
usual suspect. Is it?

This repository is the generated history of a small production line, and a
daemon that can stream the line's instruments live:

- **Bioreactor B**, fed glucose by **Feed Pump 2**: pH, temperature,
  viscosity, glucose feed rate.
- **Robotic Arm 3** pipettes samples from Bioreactor B to the HPLC: torque,
  cycle count.
- **HPLC Suite 1** assays each sample: retention time, column pressure, peak
  area.

The history (`kb/`, `batches/`, `maintenance/`, `deviations/`, `history/`)
holds the engineering notes, SOPs, vendor notes, batch records, work orders
and past deviations of the line, as typed facts.

## Run it

With [na8ve agent](https://github.com/na8ve/na8ve-agent):

```
na8ve-agent
/login            # choose na8ve; sign in or create your account in the browser
/demo biotech     # fetches this repository, seeds it into a space, asks the question
```

New to na8ve.com? Your first `/demo` makes a free workspace for you.

Then ask follow-ups, for example:

- Why did E-14 fire on Robotic Arm 3, and what should be checked first?
- Has this happened before, and what fixed it then?
- Is the HPLC's retention time telling us anything?

### The live line (optional)

`daemon/lab-daemon.mjs` streams the three instruments into your space and
raises E-14 when the arm's torque drops. It needs an ingest key for the space
(`daemon/alarms.jsonc` is the alarm it registers):

```
na8ve-agent ingest-key create lab-daemon --alarms daemon/alarms.jsonc
node daemon/lab-daemon.mjs --dry-run      # prints what it would send, sends nothing
node daemon/lab-daemon.mjs                # streams for 30 minutes, then stops
```

## What a good answer does

- It does not stop at the arm. It follows the chain upstream, through the
  bioreactor, to the machine that actually started it.
- It says why gripper wear is the wrong answer this time.
- It names what to check first, and what past work orders or deviations
  support that.
- It cites the memories it relied on at each step.

## Synthetic data

Everything here is generated. No real lab, product or batch is described.

Licensed under Apache-2.0 (see [LICENSE](LICENSE)). Security reports:
[SECURITY.md](SECURITY.md).
