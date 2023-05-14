module Admin
  class SourcesController < AdminControllerBase
    def index
    end

    def edit
      @source = Source.find(params[:id])

      @grouped_sources = {
        "Catalogued" => Source.catalogued.pluck(:code, :id),
        "Uncatalogued" => Source.uncatalogued.pluck(:code, :id),
      }

      @composition_types = CompositionType.order(:name).pluck(:name, :id)

      @inclusions = @source.inclusions
        .includes({composition: [:composition_type, :title]}, :attributions, :clef_combination)
        .order(:order)
        .to_a

      @inclusions = Kaminari.paginate_array(@inclusions)
        .page(params[:page])
        .per(40)

      @inclusions.each do |i|
        i.attributions.build

        i.composition ||= Composition.new(title: Title.new)
      end

      if @inclusions.last_page? || @inclusions.total_pages == 0
        last_inclusion = @inclusions.last
        last_order = last_inclusion&.order || -1

        num_blank_rows = [40, (20 - @inclusions.count)].max

        @blank_inclusions = (1...num_blank_rows).map do |n|
          inclusion = @source.inclusions.build(order: last_order + n + 1)
          inclusion.composition = Composition.new(title: Title.new)
          inclusion.attributions.build
          inclusion
        end
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

      check_changed_titles(source)

      unless source.save && assign_compositions
        flash[:error] = source.errors.full_messages.to_sentence
      end

      redirect_to edit_admin_source_path(source, page: params[:page])
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
          :id,
          :notes,
          :order,
          display_clefs: [],
          attributions_attributes: [
            :id,
            :refers_to_id,
            :text,
          ],
          composition_attributes: [
            :id,
            :composition_type_id,
            title_attributes: [
              :id,
              :text,
            ]
          ]
        ],
      )
    end

    def check_changed_titles(source)
      source.inclusions = source.inclusions.map do |inclusion|
        if inclusion.composition.title.text_changed?
          new_comp = inclusion.composition.dup
          new_comp.title = Title.find_or_initialize_by(text: inclusion.composition.title.text)
          inclusion.composition = new_comp
        end

        inclusion
      end
    end

    def assign_compositions
      inclusion_ids = source_params[:inclusions_attributes].to_unsafe_hash.map { |_, attributes|
        attributes[:id]
      }

      Inclusion.where(id: inclusion_ids).includes(composition: [:title, :group]).each do |inclusion|
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
