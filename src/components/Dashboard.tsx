import React from 'react';
import { makeStyles } from '@material-ui/core/styles';
import { Card, CardContent } from '@material-ui/core';
import DashHeader from './DashHeader';
import Chart from './Chart';
import { client } from '../App';
import { useSubscription } from '@apollo/react-hooks';
import { gql } from '@apollo/client';

const useStyles = makeStyles({
  card: {
    margin: '5% 10%',
  },
  taskBar: {
    backgroundColor: 'silver',
  },
});

//grab date object for thirty minutes prior to be passed into query
const thirtyMinutesAgo = new Date(Date.now() - 30 * 60000).getTime();

//metric names are fetched from the API and passed to getInputQuery to avoid hardcoding the query
const getMetricsQuery = `
  query{
    getMetrics
  }
`;

//builds a query to be passed into getDataQuery
const getInputQuery = (metrics: string[]) => {
  return metrics.map(metric => {
    return `{ metricName: "${metric}", after: ${thirtyMinutesAgo} }`;
  });
};

const getDataQuery = (inputQuery: string[]) => {
  return `
 query {
   getMultipleMeasurements(input: [${inputQuery}]){
     metric,
     measurements {
       metric,
       at,
       value,
       unit
     }
   }
 }
`;
};

const newMeasurementsSub = gql`
  subscription {
    newMeasurement {
      metric
      at
      value
      unit
    }
  }
`;

const fetchMetrics = async () => {
  const res = await client.query({
    query: gql`
      ${getMetricsQuery}
    `,
  });
  return res.data.getMetrics;
};

const fetchData = async (metrics: string[]) => {
  const res = await client.query({
    query: gql`
      ${getDataQuery(getInputQuery(metrics))}
    `,
  });
  return res.data.getMultipleMeasurements;
};

//values coming from the subscription are in this format, as well as being a key/value pair in MetricNode objects
export interface Measurement {
  metric: string;
  at: number;
  value: number;
  unit: string;
}

//interface for the subscription
interface MeasurementSub {
  newMeasurement: Measurement;
}

//response from getDataQuery is an array of MetricNodes
interface MetricNode {
  metric: string;
  measurements: Measurement[];
}

//filters the transformed data to only contain data pertaining to selected metrics
const dataFilter = (data: Plotly.Data[], selection: (string | undefined)[]) => {
  let returnArr = data.filter(metricObj => {
    return selection.includes(metricObj.name);
  });

  //workaround for limitation with Plotly - it was unable to display pressure and injValveOpen
  //together without having temperature present. This dummy object tricks it into thinking the primary yaxis is present.
  const dummyObj: Plotly.Data = {
    x: [],
    y: [],
    name: '',
    yaxis: 'y',
    type: 'scatter',
    line: { color: '#444' },
  };

  returnArr.push(dummyObj);

  return returnArr;
};

//transforms the gql data object to a format compatible with Plot.ly
const dataTransformer = (data: MetricNode[]) => {
  const returnArr: Plotly.Data[] = [];
  const colorArr: string[] = ['#a83a32', '#2d8fa1', '#5ba12d', '#9c2894', '#e6ad8e', '#32403f'];
  data.forEach(metricNode => {
    let metricObj: Plotly.Data = {
      x: [],
      y: [],
      name: '',
      yaxis: '',
      type: 'scatter',
      line: { color: colorArr[data.indexOf(metricNode)] },
    };
    metricNode.measurements.forEach(measurement => {
      (metricObj.x as Plotly.Datum[]).push(new Date(measurement.at));
      (metricObj.y as Plotly.Datum[]).push(measurement.value);
    });
    metricObj.name = metricNode.metric;
    switch (metricNode.measurements[0].unit) {
      case 'F':
        metricObj.yaxis = 'y';
        break;
      case 'PSI':
        metricObj.yaxis = 'y2';
        break;
      case '%':
        metricObj.yaxis = 'y3';
    }
    returnArr.push(metricObj);
  });
  return returnArr;
};

export default () => {
  const classes = useStyles();
  const [metricStrings, setMetricStrings] = React.useState<string[]>([]);
  const [selection, setSelection] = React.useState<(string | undefined)[]>([]);
  const [initialData, setInitialData] = React.useState<Plotly.Data[]>([]);
  const [filteredData, setFilteredData] = React.useState<Plotly.Data[]>([]);
  const { loading, data } = useSubscription<MeasurementSub>(newMeasurementsSub);
  const [prevSubData, setPrevSubData] = React.useState<Measurement>({metric: "", at: 0, value: 0, unit: ""});
  const [latestData, setLatestData] = React.useState<Measurement[]>([])

  //initial "run" logic
  React.useEffect(() => {
    const initialFetch = async () => {
      //grabs metric names to avoid hardcoding
      const metricsRes = await fetchMetrics();

      //fetches data based on metrics present in the API
      const dataRes = await fetchData(metricsRes);

      //transform the data to a format compatible with Plot.ly
      const transformedData = dataTransformer(dataRes);

      //set metrics to populate select menu
      setMetricStrings(metricsRes);

      //dynamically create a template based on metrics in API for subscription data to be pushed into 
      //to be displayed on taskbar
      let initialLatestData: Measurement[] = [] 
      metricsRes.forEach((metric: string)=>{
        initialLatestData.push({metric: metric, at: 0, value: 0, unit: ""})
      })
      setLatestData(initialLatestData);

      //set the master data object, and trigger the useEffect on line 194
      setInitialData(transformedData);
    };
    initialFetch();
  }, []);

  React.useEffect(() => {
    //upon initial load, and when the menu selection changes, filter the data so that only selected data is rendered
    const filteredDataValue = dataFilter(initialData, selection);
    setFilteredData(filteredDataValue);
  }, [initialData, selection]);

  React.useEffect(()=>{
    //check the latest emission from the subscription and evaluate if the data within is updated
    if (!loading && (data?.newMeasurement.at !== prevSubData.at || data.newMeasurement.value !== prevSubData.value || data.newMeasurement.metric !== prevSubData.metric)) {
        let measurementNode = data?.newMeasurement
        let matchingSet = initialData.find((metricNode)=>metricNode.name === measurementNode?.metric);
        if (matchingSet && measurementNode){
          //push the new data into the corresponding metric's data array
          (matchingSet.x as Plotly.Datum[]).push(new Date(measurementNode.at));
          (matchingSet.y as Plotly.Datum[]).push(measurementNode.value);
          const updatedData = initialData.map((metricNode)=>{
            if(metricNode.name === measurementNode?.metric){
              return matchingSet
            } else {
              return metricNode
            }
          });
          //refresh the data in state
          setInitialData(updatedData as Plotly.Data[]);
          if (data) {
            //replace the corresponding measurement within the latestData state object
            let latestDataTemplate = latestData.map((measurement)=>{
              return measurement.metric === data.newMeasurement.metric ? data.newMeasurement : measurement
            })
            setLatestData(latestDataTemplate)

            //save this measurement to check against new subscription emissions
            setPrevSubData(data.newMeasurement)
          }
        }
      }
  },[initialData, loading, data, prevSubData, latestData])

  return (
    <Card className={classes.card}>
      <DashHeader metrics={metricStrings} selection={selection} setSelection={setSelection} latestData={latestData}/>
      <CardContent style={{ padding: 0 }}>
        <Chart data={filteredData} />
      </CardContent>
    </Card>
  );
};
