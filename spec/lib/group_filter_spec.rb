require "rails_helper"

RSpec.describe GroupFilter do
  describe ".filter(params)" do
    subject(:result) { described_class.filter(params) }

    let(:params) { {} }
    let!(:existing_group) { create(:group) }

    it "returns all groups by default" do
      other_group = create(:group)
      expect(result).to match_array([existing_group, other_group])
    end

    context "with a function" do
      let!(:target_group) { create(:group, :with_function) }
      let(:function) { target_group.functions.first }
      let(:params) { { function: function.id } }

      it "returns only the target group" do
        expect(result).to eq([target_group])
      end
    end

    context "with a composer" do
      let!(:target_group) { create(:group, :with_composer) }
      let(:composer) { target_group.composers.first }
      let(:params) { { composer: composer.id } }

      it "returns only the target group" do
        expect(result).to eq([target_group])
      end
    end

    context "with a composer country" do
      let!(:target_group) { create(:group, :with_composer, country: "Italy") }
      let(:composer) { target_group.composers.first }
      let(:params) { { composer_country: "Italy" } }

      it "returns only the target group" do
        expect(result).to eq([target_group])
      end
    end

    context "with a voice count" do
      let!(:target_group) { create(:group, :with_composition, number_of_voices: 4) }
      let(:params) { { voices: 4 } }

      it "returns only the target group" do
        expect(result).to eq([target_group])
      end
    end

    context "with a voicing" do
      let!(:target_group) { create(:group, :with_voicing) }
      let(:params) { { voicing: target_group.voicings.first.id } }

      it "returns only the target group" do
        expect(result).to eq([target_group])
      end
    end

    context "with a source" do
      # All inclusions have a source
      let!(:target_group) { create(:group, :with_inclusion) }
      let(:params) { { source: target_group.sources.first.id } }

      it "returns only the target group" do
        expect(result).to eq([target_group])
      end
    end

    context "has an edition" do
      let!(:target_group) { create(:group, :with_edition) }
      let(:params) { { has_edition: true } }

      it "returns only the target group" do
        expect(result).to eq([target_group])
      end
    end

    context "has a recording" do
      let!(:target_group) { create(:group, :with_recording) }
      let(:params) { { has_recording: true } }

      it "returns only the target group" do
        expect(result).to eq([target_group])
      end
    end

    context "can combine multiple filters" do
      let!(:target_group) { create(:group, :with_composer, number_of_voices: 4) }
      let(:composer) { target_group.composers.first }
      let(:function) { target_group.functions.first }
      let(:params) { { composer: composer.id, voices: 4 } }

      before do
        create(:group, compositions: [build(:composition, composers: [composer])])
        create(:group, :with_composition, number_of_voices: 4)
      end

      it "returns only the target group" do
        expect(result).to eq([target_group])
      end
    end

    describe "full text search" do
      let(:params) { { q: query } }

      context "when searching group display titles" do
        let!(:target_group) { create(:group, display_title: "Target Group") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching title texts" do
        let!(:target_group) { create(:group, :with_composition, title: "Target Title") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching attribution texts" do
        let!(:target_group) { create(:group, :with_inclusion, attribution_text: "Target Attribution") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching composer names" do
        let!(:target_group) { create(:group, :with_composer, composer_name: "Target Composer") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching source titles" do
        let!(:target_group) { create(:group, :with_inclusion, source_title: "Target Source") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching source codes" do
        let!(:target_group) { create(:group, :with_inclusion, source_code: "Target Code") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching source dates" do
        let!(:target_group) { create(:group, :with_inclusion, source_from_year_annotation: "Target Date") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching source locations" do
        let!(:target_group) { create(:group, :with_inclusion, source_town: "Target Location") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching source types" do
        let!(:target_group) { create(:group, :with_inclusion, source_type: "Target Type") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching edition voicing" do
        let!(:target_group) { create(:group, :with_edition, edition_voicing: "Target Voicing") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching edition file URLs" do
        let!(:target_group) { create(:group, :with_edition, edition_file_url: "target_file.pdf") }
        let(:query) { "target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching recording file URLs" do
        let!(:target_group) { create(:group, :with_recording, recording_file_url: "target_file.pdf") }
        let(:query) { "target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      context "when searching editor names" do
        let!(:target_group) { create(:group, :with_edition, editor_name: "Target Editor") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end

      describe "when searching performer names" do
        let!(:target_group) { create(:group, :with_recording, performer_name: "Target Performer") }
        let(:query) { "Target" }

        it "returns only the target group" do
          expect(result).to eq([target_group])
        end
      end
    end
  end
end
