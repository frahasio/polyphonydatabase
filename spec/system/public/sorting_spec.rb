require "rails_helper"

RSpec.describe "Sorting", type: :system do
  it "allows sorting by title" do
    group_1 = create(:group, display_title: "A")
    group_3 = create(:group, display_title: "C")
    group_2 = create(:group, display_title: "B")

    visit groups_path

    expect(page).to have_css(".group", count: 3)

    expect(page).to have_css(".group:nth-of-type(1) .title", text: "A")
    expect(page).to have_css(".group:nth-of-type(2) .title", text: "B")
    expect(page).to have_css(".group:nth-of-type(3) .title", text: "C")

    click_on "Title"

    expect(page).to have_css(".group:nth-of-type(1) .title", text: "C")
    expect(page).to have_css(".group:nth-of-type(2) .title", text: "B")
    expect(page).to have_css(".group:nth-of-type(3) .title", text: "A")

    click_on "Title"

    expect(page).to have_css(".group:nth-of-type(1) .title", text: "A")
    expect(page).to have_css(".group:nth-of-type(2) .title", text: "B")
    expect(page).to have_css(".group:nth-of-type(3) .title", text: "C")
  end
end
