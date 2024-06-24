module Admin
  class SourcesController < AdminControllerBase
    def index; end

    def edit
      @source = Source.find(params[:id])

      @grouped_sources = {
        "Catalogued" => Source.catalogued.pluck(:code, :id),
        "Uncatalogued" => Source.uncatalogued.pluck(:code, :id),
      }

      @composition_types = CompositionType.order(:name).pluck(:name, :id)

      @inclusions = @source.inclusions
        .includes(:attributions, :clef_inclusions, composition: [:title, :composers, :composition_type])
        .order(:order)
        .to_a

      @inclusions = Kaminari.paginate_array(@inclusions)
        .page(params[:page])
        .per(40)

      @inclusions.each do |i|
        i.composition ||= Composition.new(title: Title.new)
        i.attributions.build
        (8 - (i.clef_inclusions.size % 8)).times { i.clef_inclusions.build }
      end

      if @inclusions.last_page? || @inclusions.total_pages == 0
        last_inclusion = @inclusions.last
        last_order = last_inclusion&.order || -1

        num_blank_rows = [40, (20 - @inclusions.count)].max

        @blank_inclusions = (1...num_blank_rows).map do |n|
          @source.inclusions.build(order: last_order + n + 1).tap do |inclusion|
            inclusion.composition = Composition.new(title: Title.new)
            inclusion.attributions.build
            8.times { inclusion.clef_inclusions.build }
          end
        end

        @composition = Composition.new if new_composition?
      end
    end

    def create
      source = Source.new(source_params)

      unless source.save
        flash[:error] = source.errors.full_messages.to_sentence
      end

      redirect_to admin_sources_path
    end

    def update
      source = Source.find(params[:id])

      unless source.update(source_params)
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
          :composition_id,
          :notes,
          :order,
          attributions_attributes: [
            :id,
            :refers_to_id,
            :text,
          ],
          clef_inclusions_attributes: [
            :id,
            :display,
            :_destroy,
          ],
        ],
      )
    end

    def new_composition?
      @new_composition ||= params[:new_composition] == "true"
    end
    helper_method :new_composition?
  end
end
