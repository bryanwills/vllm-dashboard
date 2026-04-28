declare module "react-plotly.js/factory" {
  import { ComponentType } from "react";
  function createPlotlyComponent(plotly: object): ComponentType<{
    data: object[];
    layout?: object;
    config?: object;
    style?: React.CSSProperties;
    useResizeHandler?: boolean;
  }>;
  export default createPlotlyComponent;
}

declare module "plotly.js-basic-dist-min" {
  const Plotly: object;
  export default Plotly;
}
