require "rails_helper"

RSpec.describe "Pagination", type: :system do
  let!(:groups) { create_list(:group, 30, :with_composition) }

  it "paginates groups on the homepage" do
    visit groups_path

    expect(page).to have_css(".group", count: 25)

    expect(page).to have_link("2", href: groups_path(page: 2))
    expect(page).to have_link("Next", href: groups_path(page: 2))

    click_on "Next"

    expect(page).to have_css(".group", count: 5)
  end

  it "has an adjustable page size" do
    # 60 total
    create_list(:group, 30, :with_composition)

    visit groups_path

    expect(page).to have_css(".group", count: 25)

    select "50", from: "page_size"
    click_on "Go"

    expect(page).to have_css(".group", count: 50)
  end

  it "doesn't affect the other filtering options" do
    create_list(:group, 29, :with_composition)
    create(:group, :with_composition, composition_tone: "1")

    visit groups_path
    expect(page).to have_css(".group", count: 25)

    select "primi toni", from: "tone"
    click_on "Filter"

    expect(page).to have_css(".group", count: 1)

    select "50", from: "page_size"
    click_on "Go"

    expect(page).to have_css(".group", count: 1)

    select "All tones", from: "tone"
    click_on "Filter"

    expect(page).to have_css(".group", count: 50)
  end
end
