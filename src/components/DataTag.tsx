import React from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Chip from '@material-ui/core/Chip';
import { Measurement } from './Dashboard';

const useStyles = makeStyles({
  chip: {
    minWidth: 250,
    margin: 3,
    fontSize: 15,
  },
});

export function DataTag(props: { measurement: Measurement }) {
  const classes = useStyles();
  const { measurement } = props;

  return <Chip className={classes.chip} label={`${measurement.metric}: ${measurement.value}${measurement.unit}`} />;
}
