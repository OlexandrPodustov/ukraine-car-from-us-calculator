function createUiMethods(){
  var all=__createAllMethods();
  var pick=["saveToLocalStorage","getCurrentLocation","getCurrentPort","onLocationBlur","onLocationChange","selectLocation","getVal","parseDollars"];
  var out={}; pick.forEach(function(k){ if(all[k]) out[k]=all[k]; }); return out;
}
