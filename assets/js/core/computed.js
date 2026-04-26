function createComputed() {
  return {
                    filteredLocations: function () {
                      var q       = (this.locationSearch || '').toLowerCase().trim();
                      var auction = this.autoPricing.auctions.selected;   // 'copart' | 'iaai'

                      return this.autoShipping.location.options.filter(function(loc) {
                        var name = loc.name.toLowerCase();

                        // фільтр по аукціону
                        if (auction === 'copart' && name.indexOf('(iaai)')   !== -1) return false;
                        if (auction === 'iaai'   && name.indexOf('(copart)') !== -1) return false;

                        // текстовий пошук
                        if (!q) return true;
                        return name.indexOf(q) !== -1;
                      });
                    }
  };
}
