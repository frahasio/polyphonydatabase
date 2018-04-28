module Admin
  class SourcesController < AdminControllerBase
    def index
    end

    def edit
      @source = Source.find(params[:id])
      @sources = Source.all

      @grouped_sources = @sources.each_with_object(Hash.new {|h, k| h[k] = []}) { |s, h|
        h[s.catalogued ? "Catalogued" : "Uncatalogued"] << [s.code, s.id]
      }

      @inclusions = @source.inclusions.order(:order).to_a

      last_inclusion = @inclusions.last
      last_order = last_inclusion&.order || -1

      @clefs_inclusions = {}
      @inclusions.each do |i|
        i.attributions.build

        i.composition ||= Composition.new(title: Title.new)
      end

      num_blank_rows = [10, (20 - @inclusions.count)].max

      num_blank_rows.times do |n|
        inclusion = @source.inclusions.build(order: last_order + n + 1)
        inclusion.composition = Composition.new(title: Title.new)
        inclusion.attributions.build

        @inclusions << inclusion
      end
    end

    def create
      source = Source.create!(source_params)

      unless source.persisted?
        flash[:error] = source.errors.full_messages.to_sentence
      end

      redirect_to admin_sources_path
    end

    def update
      source = Source.find(params[:id])

      source.assign_attributes(source_params)

      unless source.save && assign_compositions(source)
        flash[:error] = source.errors.full_messages.to_sentence
      end

      redirect_to edit_admin_source_path(source)
    end

    def switch_to
      redirect_to edit_admin_source_path(params[:id])
    end

  private

    def source_params
      params.require(:source).permit(
        :catalogued,
        :code,
        :format,
        :from_year_annotation,
        :from_year,
        :publisher_or_scribe,
        :rism_link,
        :title,
        :to_year_annotation,
        :to_year,
        :town,
        :type,
        :url,
        publisher_ids: [],
        scribe_ids: [],
        inclusions_attributes: [
          :attributed_to,
          :id,
          :notes,
          :order,
          display_clefs: [],
          piece_attributes: [
            :id,
            :title,
          ],
          attributions_attributes: [
            :id,
            :refers_to_id,
            :text,
          ],
          composition_attributes: [
            :id,
            title_attributes: [
              :id,
              :text,
            ]
          ]
        ],
      )
    end

    def assign_compositions(saved_source)
      source = Source.find(saved_source.id)
      source.inclusions.all? do |inclusion|
        current_comp = inclusion.composition

        possible_comps = Composition.where(
          number_of_voices: inclusion.minimum_voice_count,
          title: current_comp.title,
        ).includes(:composers)

        existing_comp = possible_comps.find {|c|
          c.composers.sort == inclusion.composers.sort
        }

        if existing_comp
          inclusion.composition = existing_comp unless existing_comp == current_comp
        else
          inclusion.composition = Composition.new(
            number_of_voices: inclusion.minimum_voice_count,
            title: current_comp.title,
            composers: inclusion.composers,
            group: current_comp.group,
          )
        end

        saved = inclusion.save

        current_comp.delete_if_empty(inclusion) unless existing_comp && existing_comp == current_comp

        saved
      end
    end
  end
end
