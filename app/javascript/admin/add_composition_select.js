export default function addCompositionSelect() {
  $(document).ready(function () {
    var select = $("select.composition").select2({
      ajax: {
        url: "/admin/compositions",
        dataType: "json"
      }
    })
  })
}
