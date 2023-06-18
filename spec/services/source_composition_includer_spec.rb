require "rails_helper"

RSpec.describe SourceCompositionIncluder do
  subject(:call) { described_class.call(source) }

  let(:source) { create(:source) }

  let(:composers) { [] }
  let(:composition_type) { nil }
  let(:even_odd) { nil }
  let(:number_of_voices) { nil }
  let(:title) { nil }
  let(:tone) { nil }

  let(:compositions) { source.inclusions.map(&:composition) }

  before do
    source.inclusions.build(
      attributions: composers.map { |c| build(:attribution, refers_to: c) },
      clef_combination: ClefCombination.from_display(%w[g4] * number_of_voices)[:combination],
      composition: build(:composition,
        composition_type:,
        even_odd:,
        number_of_voices:,
        title:,
        tone:,
      ),
    )
  end

  shared_examples_for "it creates a composition and includes it in the source" do
    it "creates a composition and includes it in the source" do
      call

      new_composition = compositions.last

      expect(new_composition).to be_present
      expect(new_composition).to be_new_record
      expect(new_composition.composers).to match_array(composers)
      expect(new_composition.composition_type).to eq(composition_type)
      expect(new_composition.even_odd).to eq(even_odd)
      expect(new_composition.number_of_voices).to eq(number_of_voices)
      expect(new_composition.title.text).to eq(title.text)
      expect(new_composition.tone).to eq(tone)
    end
  end

  context "if there is an existing composition" do
    let!(:existing_composition) do
      create(:composition,
        composers:,
        even_odd: "even",
        number_of_voices: 4,
        tone: 1,
      )
    end

    let(:composers) { create_list(:composer, 3) }
    let(:composition_type) { existing_composition.composition_type }
    let(:even_odd) { existing_composition.even_odd }
    let(:number_of_voices) { existing_composition.number_of_voices }
    let(:title) { existing_composition.title }
    let(:tone) { existing_composition.tone }

    it "includes the existing composition in the source" do
      call

      expect(compositions).to include(existing_composition)
    end

    context "and only one of the attributed composers is on the existing composition" do
      before do
        existing_composition.update(composers: composers.take(1))
      end

      it "includes the existing composition in the source" do
        call

        expect(compositions).to include(existing_composition)
      end
    end

    context "and more than one but not all of the attributed composers are on the existing composition" do
      before do
        existing_composition.update(composers: composers.take(2))
      end

      it "includes the existing composition in the source" do
        call

        expect(compositions).to include(existing_composition)
      end
    end

    context "but the title doesn't match" do
      before do
        existing_composition.update(title: create(:title, text: "Something else"))
      end

      include_examples "it creates a composition and includes it in the source"
    end

    context "but the number of voices doesn't match" do
      before do
        existing_composition.update(number_of_voices: number_of_voices + 1)
      end

      include_examples "it creates a composition and includes it in the source"
    end

    context "but none of attributed composers appear on the existing composition" do
      before do
        existing_composition.update(composers: create_list(:composer, 3))
      end

      include_examples "it creates a composition and includes it in the source"
    end

    context "and only the Anon composer matches" do
      let(:composers) { [Composer.anon] }

      before do
        existing_composition.update(composers: [Composer.anon])
      end

      include_examples "it creates a composition and includes it in the source"
    end

    context "but the tone doesn't match" do
      before do
        existing_composition.update(tone: tone.to_i + 1)
      end

      include_examples "it creates a composition and includes it in the source"
    end

    context "but the even_odd doesn't match" do
      before do
        existing_composition.update(even_odd: "odd")
      end

      include_examples "it creates a composition and includes it in the source"
    end

    context "but the composition_type doesn't match" do
      before do
        existing_composition.update(composition_type: build(:composition_type))
      end

      include_examples "it creates a composition and includes it in the source"
    end
  end
end
