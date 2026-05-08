import React, { useEffect } from "react";
import PropTypes from "prop-types";

import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import useStore from "../../store";

const { electron } = window;

const LinearProgressWithLabel = (props) => {
  return (
    <Box sx={{ display: "flex", alignItems: "center" }}>
      <Box sx={{ width: "100%", m: 2 }}>
        <LinearProgress
          variant="determinate"
          sx={{
            backgroundColor: "5C87B1",
            "& .MuiLinearProgress-bar": {
              backgroundColor: "#2A4D69",
            },
          }}
          {...props}
        />
      </Box>
      <Box sx={{ minWidth: 35, mr: 2 }}>
        <Typography variant="body2" color="text.secondary">{`${Math.round(
          props.value
        )}%`}</Typography>
      </Box>
    </Box>
  );
};

LinearProgressWithLabel.propTypes = {
  value: PropTypes.number.isRequired,
};

const Loader = () => {
  const { progress, setProgress } = useStore();

  useEffect(() => {
    if (!electron?.subscribeProgress) {
      console.log("Not running in electron");
      return;
    }
    const unsubscribe = electron.subscribeProgress((json) => {
      setProgress(json.progress);
    });
    return unsubscribe;
  }, []);

  return (
    progress > 0 &&
    progress < 100 && (
      <Box sx={{ width: "100%" }}>
        <LinearProgressWithLabel value={progress} />
      </Box>
    )
  );
};

export default Loader;
