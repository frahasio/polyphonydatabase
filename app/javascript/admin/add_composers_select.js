export default function addComposersSelect() {
  $(document).ready(function () {
    var select = $("select.composers").select2({
      ajax: {
        url: "/admin/composers",
        dataType: "json"
      }
    })
  })
}
