var shippingPorts = [
  {
    id: "new_york",
    name: "New York (NY)",
    toPort: {
      odessa: 750,
    },
  },
  {
    id: "savannah",
    name: "Savannah (GA)",
    toPort: {
      odessa: 750,
    },
  } /*{ id: "houston", name: "Houston (TX)", toPort: { odessa: -1 } },*/,
  {
    id: "los_angeles",
    name: "Los Angeles (CA)",
    toPort: {
      odessa: 995,
    },
  },
  {
    id: "san_francisco",
    name: "San Francisco (CA)",
    toPort: {
      odessa: 975,
    },
  },
];
var destinationPorts = [{ id: "odessa", name: "Odessa (Ukraine)" }];
window.shippingPorts = shippingPorts;
window.destinationPorts = destinationPorts;
export { shippingPorts };
