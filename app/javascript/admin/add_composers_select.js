export default function addComposersSelect() {
  $(document).ready(function () {
    $("select.composers").select2({
      ajax: {
        url: "/admin/composers",
        dataType: "json"
      },
      tags: true,
    })
  })
}
